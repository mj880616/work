// S69-06 실제 사이트 원문 점검(읽기만, 저장 없음). GitHub Actions `article-extract-live-check.yml`이 Deno로 돌린다(로컬 node 22+도 됨).
// 하는 일: 뉴스 카탈로그(news-*) 전부 + 사회운동 Now 카탈로그(outside) 전부에서 목록(피드·목록 쪽)을 읽고 최신 글 몇 개를
//   운영 Edge 함수와 **같은 코드**로 읽어 본문을 뽑은 뒤, 매체별 결과를 숫자·까닭 코드로만 표에 쓴다.
//   - 뉴스 글: news-feed 원문 읽기(makeFeedReader, robots 건너뜀 = 운영 '기사 원문 한 쪽' 규칙) → page.ts readArticlePage(mediaRule)
//   - 사회운동 글: outside-feed makeReader → postBody(수집 때 길: 피드 본문 200자 이상이면 피드 본문) + 다시 읽기 길(글 쪽, robots 건너뜀)
// 지키는 것:
//   - 글 내용(제목·본문 글자·주소)을 표·로그에 쓰지 않는다. 숫자·코드·쪽 구조(태그·class 이름)만.
//   - 운영과 같은 User-Agent·같은 사이트 요청 간격(GAP_MS)·크기·시간 상한. 쿠키·로그인·비밀값 없음. 유료벽·봇 확인은 넘지 않는다.
//   - 매체당 글 PER_SOURCE개(기본 3)까지. 매체끼리는 동시에 몇 개씩(사이트마다 간격은 따로 지킴).
// 결과 칸: ok(전문) · lead(앞부분) · img(사진뿐) · fail:<까닭>. '의심'은 전문으로 뽑혔지만 페이지 안 구조화 본문·쪽 글자보다 훨씬 짧은 경우.
import { NEWS_CATALOG } from "../../supabase/functions/_shared/news-catalog.ts";
import { OUTSIDE_CATALOG, allowedUrl } from "../../supabase/functions/_shared/outside-catalog.ts";
import { makeFeedReader, ACCEPT_FEED, ACCEPT_HTML, cleanArticleUrl } from "../../supabase/functions/_shared/feed-fetch.ts";
import { jsonBody } from "../../supabase/functions/_shared/page-json-body.ts";
import * as N from "../../supabase/functions/news-feed/handler.ts";
import * as O from "../../supabase/functions/outside-feed/handler.ts";
import { readArticlePage } from "../../supabase/functions/news-feed/page.ts";
import { parseFeed, parseListHtml, parseTelegram, htmlToText, looksLikeBotCheck } from "../../supabase/functions/outside-feed/parse.ts";

const env = (k, d) => (globalThis.Deno ? Deno.env.get(k) : process.env[k]) ?? d;
const PER_SOURCE = Math.max(1, Math.min(5, Number(env("PER_SOURCE", "3")) || 3));
const PARALLEL = Math.max(1, Math.min(8, Number(env("PARALLEL", "6")) || 6));
const ONLY = (env("ONLY", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DIAG = env("DIAG", "1") === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {};
const chars = (s) => [...(s ?? "")].length;

// ---- 쪽 구조 진단(글자 없이 숫자·태그 이름만) ----------------------------------------------------------------------
// 글자가 가장 많이 몰린 칸(그 칸 바로 아래 <p>·글 줄 글자 수 기준) 상위 3개: tag#id.class 와 글자 수. 본문 칸 선택자를 찾는 데 쓴다.
function topBlocks(html) {
  const out = [];
  const open = /<(div|section|article|main|td)\b([^>]*)>/gi;
  let m, n = 0;
  while ((m = open.exec(html)) && n++ < 4000) {
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(m[2])?.[1]?.trim().split(/\s+/).slice(0, 3).join(".") ?? "";
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(m[2])?.[1] ?? "";
    if (!cls && !id) continue;
    const tag = m[1].toLowerCase();
    const step = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    step.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1, t;
    while ((t = step.exec(html))) { if (t[1]) { if (--depth === 0) { end = t.index; break; } } else if (!t[0].endsWith("/>")) depth++; }
    if (end < 0) continue;
    const inner = html.slice(m.index + m[0].length, end).replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
    const pText = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].reduce((a, x) => a + chars(htmlToText(x[1]).replace(/\s+/g, "")), 0);
    const all = chars(htmlToText(inner).replace(/\s+/g, ""));
    if (all < 300) continue;
    out.push({ sel: `${tag}${id ? "#" + id : ""}${cls ? "." + cls : ""}`.slice(0, 80), all, p: pText });
  }
  // 가장 안쪽 칸: 문단(<p>) 글자가 가장 많은 칸의 80% 이상을 가진 칸들 가운데 전체 글자가 작은(안쪽) 순 3개.
  //   <p>가 거의 없는 쪽(<br>로 줄을 나누는 게시판)은 전체 글자로 같은 방식.
  const maxP = Math.max(0, ...out.map((o) => o.p));
  const byP = maxP >= 300;
  const top = byP ? maxP : Math.max(0, ...out.map((o) => o.all));
  const pick = out.filter((o) => (byP ? o.p : o.all) >= top * 0.8).sort((a, b) => a.all - b.all).slice(0, 3);
  // 전체 글자 기준으로도(문단이 <br>로만 나뉜 본문): 가장 큰 칸 글자의 50% 이상인 칸 중 안쪽 3개.
  const maxAll = Math.max(0, ...out.map((o) => o.all));
  const pickAll = out.filter((o) => o.all >= maxAll * 0.5).sort((a, b) => a.all - b.all).slice(0, 3);
  const item = [...html.matchAll(/<([a-z]+)\b[^>]*\bitemprop\s*=\s*["']articleBody["'][^>]*>/gi)].map((m) => {
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]?.trim().split(/\s+/).slice(0, 2).join(".") ?? "";
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? "";
    return `${m[1]}${id ? "#" + id : ""}${cls ? "." + cls : ""}`.slice(0, 60);
  }).slice(0, 2);
  return pick.map((o) => `${o.sel}:${o.all}/${o.p}`).join(" ") + ` ‖ ${pickAll.map((o) => `${o.sel}:${o.all}/${o.p}`).join(" ")}` + (item.length ? ` ‖ itemprop=${item.join(",")}` : "");
}
// 스크립트 자료(글자 없이): 큰 스크립트 3개의 id·type·길이, 본문이 실릴 만한 JSON 열쇠 이름이 있는지.
function scriptHints(html) {
  const list = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => {
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(m[1])?.[1] ?? "";
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(m[1])?.[1] ?? "";
    return { tag: `${id ? "#" + id : ""}${type ? "[" + type + "]" : ""}`.slice(0, 40), len: m[2].length };
  }).sort((a, b) => b.len - a.len).slice(0, 3);
  const keys = ["articleBody", "content_elements", "articleContent", "newsContent", "\"content\":", "\"body\":", "\"html\":", "\"text\":", "artcContent", "contentHtml"]
    .filter((k) => html.includes(k)).map((k) => k.replace(/[":]/g, ""));
  // 본문 열쇠 바로 뒤 모양(글자·숫자는 x로 가린다 — 이스케이프·따옴표 모양만): 구조화 본문 읽기 규칙을 맞추는 데 쓴다.
  const at = html.search(/articleContent|newsContent|artcContent/);
  const shape = at >= 0 ? html.slice(Math.max(0, at - 12), at + 40).replace(/[\p{L}\p{N}]/gu, "x").replace(/\s+/g, "_") : "";
  return `${list.map((x) => `${x.tag || "-"}:${x.len}`).join(",")} keys=${keys.join(",") || "-"}${shape ? ` shape=${shape}` : ""}`;
}
function pageHints(html) {
  const jb = jsonBody(html);
  const ldRaw = /"articleBody"\s*:/.test(html);
  return {
    bytes: html.length,
    textAll: chars(htmlToText(html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")).replace(/\s+/g, "")),
    json: jb ? `${jb.via}:${chars(jb.text)}` : (ldRaw ? "ld_raw" : "-"),
    amp: /<link\b[^>]*rel\s*=\s*["']amphtml["']/i.test(html) ? 1 : 0,
    nextData: /__NEXT_DATA__|__NUXT__|Fusion\.globalContent|window\.__INITIAL_STATE__/.test(html) ? 1 : 0,
    pTags: (html.match(/<p\b/gi) ?? []).length,
    bot: looksLikeBotCheck(htmlToText(html)) ? 1 : 0,
  };
}

function cell(ex) {
  if (!ex) return "-";
  if (ex.state === "ok") return "ok";
  if (ex.state === "lead") return `lead:${ex.reason ?? "-"}`;
  if (ex.state === "image_only") return "img";
  return `fail:${ex.reason ?? "-"}`;
}
// 분야 진단 도움: 값별 개수 상위 10개("값:수"), 주소 첫 경로 조각(숫자·긴 조각은 # — 기사 번호를 쓰지 않음).
//   분야 칸 값은 섹션 이름만 남기려고 2번 넘게 나온 짧은 값(12자 안쪽)만 그대로 쓰고 나머지는 '기타'로 묶는다(꼬리표 낱말이 그대로 나가지 않게).
function tally(values, sectionOnly = false) {
  const m = new Map();
  for (const v of values) { const k = String(v).replace(/[|\n\r]/g, " ").trim().slice(0, 24) || "-"; m.set(k, (m.get(k) ?? 0) + 1); }
  const out = new Map();
  for (const [k, n] of m) { const key = sectionOnly && (n < 2 || [...k].length > 12) ? "기타" : k; out.set(key, (out.get(key) ?? 0) + n); }
  return [...out].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k}:${n}`).join(",");
}
function firstSeg(url) {
  try { const segs = new URL(url).pathname.split("/").filter(Boolean).slice(0, 2).map((x) => /\d{3,}|^.{25,}$/.test(x) ? "#" : x); return "/" + segs.join("/"); } catch { return "-"; }
}
const paras = (ex) => (ex?.blocks ?? []).filter((b) => b.t === "p" || b.t === "quote").length;

// ---- 뉴스 매체 -----------------------------------------------------------------------------------------------------
async function checkNews(source, nowMs) {
  const base = { doFetch: fetch, sleep, log: quiet, userAgent: N.USER_AGENT, robotsAgent: N.ROBOTS_AGENT, gapMs: N.GAP_MS, now: Date.now };
  const catalog = makeFeedReader({ ...base, allow: (raw) => allowedUrl(source, raw) });
  const page = makeFeedReader({ ...base, allow: (raw) => allowedUrl(source, raw), skipRobots: N.ARTICLE_SKIP_ROBOTS });
  const row = { group: "news", key: source.key, name: source.name, extract: source.extract === false ? "X" : `v${source.extract?.version ?? 1}`, list: "ok", posts: [] };
  const urls = [];
  for (const list of source.lists) {
    if (urls.length >= PER_SOURCE && !DIAG) break;
    let got = await catalog.get(list, ACCEPT_FEED);
    // 점검용만: robots.txt가 이 러너에서 안 열리면(일시 오류·러너 지역 차단 — '막음'이 아님) 글 주소를 얻으려고 피드만 한 번 더 읽는다.
    //   운영 수집은 그대로 robots를 지킨다. robots가 '막음'(robots·robots_denied)이면 다시 읽지 않는다.
    if (!got.ok && got.code === "robots_unreachable") {
      got = await page.get(list, ACCEPT_FEED);
      row.list = got.ok ? "robots_unreachable(피드만)" : `robots_unreachable/${got.code}`;
    }
    if (!got.ok) { if (!row.list.startsWith("robots_unreachable")) row.list = got.code; continue; }
    const xml = N.httpsLinkXml(source, got.text);
    // 진단: 피드 글 수와 첫 글 링크의 주소 모양(scheme://host만 — 경로·제목 없음).
    const rawItems = (xml.match(/<(item|entry)\b/gi) ?? []).length;
    const firstLink = /<(?:item|entry)\b[\s\S]*?<link\b[^>]*?(?:href\s*=\s*["']\s*([a-z]+:\/\/[^/"'\s]+)|>\s*(?:<!\[CDATA\[)?\s*([a-z]+:\/\/[^/\s<\]]+))/i.exec(xml);
    row.feed = `items=${rawItems} link=${firstLink ? (firstLink[1] ?? firstLink[2]) : "-"} type=${(got.contentType ?? "-").split(";")[0]} bytes=${got.text.length}`;
    // 피드 대신 짧은 HTML이 오면(사람 확인·이동 쪽): 표시만 숫자·코드로.
    if (!rawItems && got.text.length < 20000) {
      const t = got.text;
      row.feed += ` refresh=${/http-equiv\s*=\s*["']?refresh/i.test(t) ? 1 : 0} jsnav=${/location\.(href|replace)|window\.location/.test(t) ? 1 : 0} cookie=${/document\.cookie/.test(t) ? 1 : 0} scripts=${(t.match(/<script\b/gi) ?? []).length} bot=${looksLikeBotCheck(t) ? 1 : 0}`;
    }
    const parsed = parseFeed(N.parseSource(source, xml), xml, nowMs, 50);
    // S71-70 분야 진단: 피드마다 글 분야 칸(category) 이름별 글 수와 기사 주소 첫 경로 조각별 글 수(제목·주소 전체는 쓰지 않음).
    if (DIAG) row.sections = [...(row.sections ?? []), `${list.replace(/^https:\/\/[^/]+/, "")} ⇒ cat[${tally(parsed.map((it) => it.category ?? "-"), true)}] path[${tally(parsed.map((it) => firstSeg(it.url)))}]`];
    for (const it of parsed) {
      if (urls.length >= PER_SOURCE) break;
      const clean = cleanArticleUrl(it.url);
      if (clean && allowedUrl(source, clean) && !urls.includes(clean)) urls.push(clean);
    }
    if (!row.list.startsWith("robots_unreachable")) row.list = "ok";
  }
  if (!urls.length && row.list.endsWith("ok")) row.list = `no_items(${row.feed ?? "-"})`;
  for (const url of urls) {
    const got = await page.get(url, ACCEPT_HTML);
    if (!got.ok) { row.posts.push({ res: `fail:${got.code}` }); continue; }
    const info = readArticlePage(got.text, nowMs, N.mediaRule(source, got.url));
    const ex = info.blocks;
    const res = info.state === "bot_check" ? "fail:bot_check" : info.state === "paywall" ? `lead:paywall(${info.paywall})` : info.body_kind === "full" ? "ok" : cell(ex);
    row.posts.push({ res, paras: paras(ex), chars: ex.chars, images: ex.images, scope: ex.scope ?? "-", cut: ex.cut ?? "-", ...(DIAG ? { hints: pageHints(got.text), top: topBlocks(got.text), scripts: scriptHints(got.text) } : {}) });
  }
  return row;
}

// ---- 사회운동 Now ---------------------------------------------------------------------------------------------------
async function checkOutside(source, nowMs) {
  const reader = O.makeReader(fetch, sleep, quiet);
  const row = { group: "outside", key: source.key, name: source.name, extract: source.extract === false ? "X" : `v${source.extract?.version ?? 1}`, list: "ok", posts: [] };
  let items = [];
  for (const list of source.lists) {
    if (items.length >= PER_SOURCE) break;
    const got = await reader.get(source, list, source.mode === "rss");
    if (!got.ok) { row.list = got.code; continue; }
    row.feed = `items=${(got.text.match(/<(item|entry)\b/gi) ?? []).length} bytes=${got.text.length} bot=${looksLikeBotCheck(got.text) ? 1 : 0}`;
    const found = source.mode === "rss" ? parseFeed(source, got.text, nowMs, 20)
      : source.mode === "telegram" ? parseTelegram(source, got.text, nowMs, 20)
      : parseListHtml(source, got.text, got.url, 20, undefined, nowMs);
    for (const it of found) if (!items.some((x) => x.url === it.url)) items.push(it);
    row.list = "ok";
  }
  items = items.slice(0, PER_SOURCE);
  if (!items.length && row.list === "ok") row.list = `no_items(${row.feed ?? "-"})`;
  for (const it of items) {
    // 수집 때 길(runSource와 같은 조건): 텔레그램·피드 본문 200자 이상이면 글 쪽을 읽지 않는다.
    const feedBody = source.mode === "telegram" || (it.content !== null && chars(it.content) >= 200);
    if (source.mode === "telegram") {
      const ex = O.postBody(source, it, null);
      row.posts.push({ res: cell(ex), paras: paras(ex), chars: ex.chars, images: ex.images, from: "telegram" });
      continue;
    }
    const feedEx = feedBody ? O.postBody(source, it, null) : null;
    // 글 쪽(다시 읽기 길: robots 건너뜀 — rereadPage와 같음).
    const got = await reader.get(source, it.url, false, { skipRobots: true });
    const pageIt = { ...it, content: null, contentHtml: null };
    const ex = O.postBody(source, pageIt, got);
    row.posts.push({ res: cell(ex), paras: paras(ex), chars: ex.chars, images: ex.images, scope: ex.scope ?? "-", cut: ex.cut ?? "-",
      feed: feedEx ? `${cell(feedEx)}:${feedEx.chars}` : "-",
      ...(DIAG && got.ok ? { hints: pageHints(got.text), top: topBlocks(got.text), scripts: scriptHints(got.text) } : {}), ...(got.ok ? {} : { code: got.code }) });
  }
  return row;
}

// ---- 실행·표 -------------------------------------------------------------------------------------------------------
const nowMs = Date.now();
const jobs = [
  ...NEWS_CATALOG.map((s) => () => checkNews(s, nowMs)),
  ...OUTSIDE_CATALOG.map((s) => () => checkOutside(s, nowMs)),
].filter((_, i) => !ONLY.length || ONLY.includes([...NEWS_CATALOG, ...OUTSIDE_CATALOG][i].key));
const rows = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const t0 = Date.now();
    try { rows.push(await Promise.race([j(), sleep(180000).then(() => { throw new Error("source_timeout"); })])); }
    catch (e) { rows.push({ group: "?", key: "?", name: "?", list: `error:${String(e?.message ?? e).slice(0, 40)}`, posts: [] }); }
    void t0;
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
const order = [...NEWS_CATALOG, ...OUTSIDE_CATALOG].map((s) => s.key);
rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

// 매체 판정: 글 하나라도 ok면서 나머지도 ok → 전문 / ok가 하나라도 → 일부 / lead·img만 → 앞부분 / 그 밖 → 실패.
function verdict(r) {
  const res = r.posts.map((p) => p.res);
  if (!res.length) return "실패";
  if (res.every((x) => x === "ok")) return "전문";
  if (res.some((x) => x === "ok")) return "일부";
  if (res.some((x) => x.startsWith("lead") || x === "img")) return "앞부분";
  return "실패";
}
const count = { 전문: 0, 일부: 0, 앞부분: 0, 실패: 0 };
const lines = [];
lines.push(`## 원문 점검 (${new Date(nowMs).toISOString()}, 매체당 글 ${PER_SOURCE}개)`);
lines.push("");
lines.push("| 묶음 | 매체 키 | 이름 | 수집판 | 목록 | 판정 | 글마다(결과 / 문단 / 글자 / 사진 / 본문칸 / 끝) |");
lines.push("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  const v = verdict(r);
  count[v]++;
  const posts = r.posts.map((p) => `${p.res} / ${p.paras ?? "-"} / ${p.chars ?? "-"} / ${p.images ?? "-"} / ${p.scope ?? p.from ?? "-"} / ${p.cut ?? "-"}${p.feed && p.feed !== "-" ? ` (피드 ${p.feed})` : ""}`).join("<br>");
  lines.push(`| ${r.group} | ${r.key} | ${r.name} | ${r.extract ?? "-"} | ${r.list} | ${v} | ${posts || "-"} |`);
}
lines.push("");
lines.push(`**합계** 매체 ${rows.length}: 전문 ${count.전문} · 일부 ${count.일부} · 앞부분 ${count.앞부분} · 실패 ${count.실패}`);
const table = lines.join("\n");
console.log(table);
if (DIAG) {
  console.log("\n## 진단(쪽 구조 숫자 — 글 내용 없음)");
  console.log("키 | 글 | 결과 | 쪽바이트 | 쪽글자 | 구조화본문 | amp | 스크립트자료 | p태그 | 봇 | 글자 많은 칸(선택자:전체/문단) | 스크립트");
  for (const r of rows) r.posts.forEach((p, i) => {
    if (!p.hints) return;
    const h = p.hints;
    console.log(`${r.key} | ${i + 1} | ${p.res} | ${h.bytes} | ${h.textAll} | ${h.json} | ${h.amp} | ${h.nextData} | ${h.pTags} | ${h.bot} | ${p.top} | ${p.scripts ?? "-"}`);
  });
}
// ---- 새 수집처 후보 피드(S71-70, 점검용만) -------------------------------------------------------------------------------
// 카탈로그에 넣기 전에 후보 주소가 이 러너에서 열리는지·robots가 허용하는지(운영 수집기와 같은 robots 판정)·글 분야 칸이 있는지를 숫자로만 본다.
// 카탈로그 밖 주소라 운영 수집기는 읽지 않는다. 주소는 이 목록에 적힌 것뿐(호스트 고정, https만).
const CANDIDATE_FEEDS = [
  "https://www.newscham.net/rss", "https://www.newscham.net/feed", "https://www.newscham.net/rss/allArticle.xml", "https://www.newscham.net/news/rss.php",
  "https://www.newscham.net/rss.xml", "https://www.newscham.net/rss/news.xml",
  "https://www.mediatoday.co.kr/rss/allArticle.xml",
  "https://newscham.net/rss", "https://newscham.net/", "https://www.newscham.net/",
  "https://www.mediatoday.co.kr/news/articleList.html?view_type=sm", "https://www.mediatoday.co.kr/news/articleList.html?sc_section_code=S1N1&view_type=sm",
];
async function checkCandidate(list) {
  const host = new URL(list).host;
  const base = { doFetch: fetch, sleep, log: quiet, userAgent: N.USER_AGENT, robotsAgent: N.ROBOTS_AGENT, gapMs: N.GAP_MS, now: Date.now };
  const reader = makeFeedReader({ ...base, allow: (raw) => { try { const u = new URL(raw); return u.protocol === "https:" && u.host === host && !u.port && !u.username ? u : null; } catch { return null; } } });
  const got = await reader.get(list, ACCEPT_FEED);
  if (!got.ok) return `${list} ⇒ ${got.code}`;
  const rawItems = (got.text.match(/<(item|entry)\b/gi) ?? []).length;
  if (!rawItems) {
    const t = got.text;
    const feeds = [...t.matchAll(/<link\b[^>]*type\s*=\s*["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? "-").slice(0, 4);
    const arts = (t.match(/articleView\.html\?idxno=\d+/g) ?? []).length;
    return `${list} ⇒ ok(html) type=${(got.contentType ?? "-").split(";")[0]} bytes=${t.length} feedlinks=[${feeds.join(",")}] articleLinks=${arts} bot=${looksLikeBotCheck(t) ? 1 : 0}`;
  }
  const pseudo = { key: "candidate", name: "-", group: "movement", lang: "ko", mode: "rss", lists: [list], hosts: [host, host.replace(/^www\./, "")], kindOf: () => "article" };
  const parsed = parseFeed(pseudo, got.text, nowMs, 50);
  return `${list} ⇒ ok type=${(got.contentType ?? "-").split(";")[0]} items=${rawItems} parsed=${parsed.length} cat[${tally(parsed.map((it) => it.category ?? "-"), true)}] path[${tally(parsed.map((it) => firstSeg(it.url)))}]`;
}
if (DIAG) {
  console.log("\n## 분야 진단(피드마다 분야 칸·주소 경로 — 글 내용 없음)");
  for (const r of rows) for (const line of r.sections ?? []) console.log(`${r.key} | ${line}`);
  console.log("\n## 새 수집처 후보 피드(점검용)");
  const cand = [];
  for (const list of CANDIDATE_FEEDS) { try { cand.push(await checkCandidate(list)); } catch (e) { cand.push(`${list} ⇒ error:${String(e?.message ?? e).slice(0, 40)}`); } }
  for (const line of cand) console.log(line);
  lines.push("", "### 새 수집처 후보 피드(점검용)", "", ...cand.map((l) => `- ${l.replace(/\|/g, "/")}`), "", "### 분야 진단", "", ...rows.flatMap((r) => (r.sections ?? []).map((l) => `- ${r.key}: ${l.replace(/\|/g, "/")}`)));
}
const summary = env("GITHUB_STEP_SUMMARY", "");
if (summary) {
  const text = lines.join("\n") + "\n";
  if (globalThis.Deno) await Deno.writeTextFile(summary, text, { append: true });
  else (await import("node:fs")).appendFileSync(summary, text);
}
