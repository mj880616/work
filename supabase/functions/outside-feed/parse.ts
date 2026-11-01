// outside-feed 읽기 도구(순수 함수, 네트워크 없음): RSS·목록 HTML 해석, 글 본문 글자 뽑기, 문장 나누기, robots.txt 판정.
// 받은 HTML은 글자만 뽑는다(태그·스크립트는 버림). 화면도 글자로만 그린다(설계 6절).
import { allowedUrl, type Kind, type OutsideSource } from "../_shared/outside-catalog.ts";

export const BODY_MAX_CHARS = 60000;      // 글 한 건 본문 상한(설계 3.1)
export const SENTENCE_MAX_CHARS = 500;    // DB 검사와 같음
export const SENTENCE_MAX_COUNT = 3001;   // idx 0~3000
export const TITLE_MAX_CHARS = 500;
export const AUTHOR_MAX_CHARS = 200;
export const URL_MAX_CHARS = 2000;

// 목록에서 찾은 글 수(종류 거르기 전). 0이면 목록을 못 뽑은 것(parse_empty), 1 이상인데 넣을 글이 0이면 '이번엔 해당 글 없음'(no_match).
export type ListStats = { candidates: number };
export type ListItem = { url: string; title: string; kind: Kind; published_at: string | null; author: string | null; summary: string | null; content: string | null };

// ---- 글자 다듬기 ----------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", copy: "©" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
// 제어 문자를 빈칸으로, 빈칸 여러 개를 하나로.
export function oneLine(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f​﻿]/g, " ").replace(/\s+/g, " ").trim();
}
export function cut(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
}
const len = (s: string) => [...s].length;

// 태그를 걷고 글자만. 문단·줄바꿈 태그는 줄바꿈으로 남긴다.
export function htmlToText(html: string): string {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|header|footer|nav|aside|dd|dt|figure|figcaption|pre|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(t)
    .split("\n")
    // deno-lint-ignore no-control-regex
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​﻿]/g, " ").replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---- 날짜 ----------------------------------------------------------------------------------------------------------

// RSS 날짜(RFC 822·ISO). 미래(하루 넘게)·너무 옛날(1990 전)이면 null.
export function feedDate(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t) || t > nowMs + 86400000 || t < Date.UTC(1990, 0, 1)) return null;
  return new Date(t).toISOString();
}
// 글 페이지 글자에서 처음 나오는 날짜(2026-10-31·2026.10.31·2026/10/31·2026년 10월 31일)를 서울 자정으로.
export function textDate(text: string, nowMs: number): string | null {
  const m = /(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})(?!\d)/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d) - 9 * 3600000;
  const back = new Date(t + 9 * 3600000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  if (t > nowMs + 86400000 || t < nowMs - 20 * 365 * 86400000) return null;
  return new Date(t).toISOString();
}

// ---- 글 주소·제목 확인 -----------------------------------------------------------------------------------------

// 글 주소를 카탈로그 규칙으로 하나로 맞춘다. 허용 호스트·scheme 밖이거나 DB 검사(http(s), 2000자, 빈칸 없음)에 안 맞으면 null.
export function canonicalUrl(source: OutsideSource, raw: string, base?: string): string | null {
  let abs: string;
  try { abs = new URL(decodeEntities(raw.trim()), base).href; } catch { return null; }
  const u = allowedUrl(source, abs);
  if (!u) return null;
  u.hash = "";
  const out = source.canon ? source.canon(u) : u.href;
  if (!/^https?:\/\/\S+$/.test(out) || out.length > URL_MAX_CHARS || !allowedUrl(source, out)) return null;
  return out;
}
export function cleanTitle(raw: string): string | null {
  // RSS·Atom(type="html") 제목은 한 번 더 이스케이프돼 오기도 해서 풀고 → 태그 걷고 → 다시 푼다.
  const t = cut(oneLine(decodeEntities(decodeEntities(raw).replace(/<[^>]*>/g, " "))), TITLE_MAX_CHARS);
  return t ? t : null;
}

// ---- RSS·Atom ------------------------------------------------------------------------------------------------------

function cdata(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<${n.replace(":", "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)</${n.replace(":", "\\:")}\\s*>`, "i");
    const m = re.exec(block);
    if (m) return cdata(m[1]).trim();
  }
  return null;
}
function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  for (const a of links) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(a)?.[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] ?? "alternate";
    if (href && rel === "alternate") return href;
  }
  return null;
}

// 피드 글 목록(최대 limit). 카탈로그 밖 주소·종류 없음(null)·제목 없음은 뺀다.
export function parseFeed(source: OutsideSource, xml: string, nowMs: number, limit = 30, stats?: ListStats): ListItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => m[2]);
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (out.length >= limit) break;
    const title = cleanTitle(tag(b, ["title"]) ?? "");
    const rawLink = tag(b, ["link"]) || atomLink(b) || tag(b, ["guid"]) || "";
    const url = canonicalUrl(source, rawLink);
    if (!title || !url || seen.has(url)) continue;
    if (stats) stats.candidates++;
    const kind = source.kindOf(title, url);
    if (!kind) continue;
    seen.add(url);
    const authorRaw = tag(b, ["dc:creator", "author"]);
    const author = authorRaw ? cut(oneLine(htmlToText(tag(authorRaw, ["name"]) ?? authorRaw)), AUTHOR_MAX_CHARS) || null : null;
    const summaryRaw = tag(b, ["description", "summary"]);
    const contentRaw = tag(b, ["content:encoded", "content"]);
    out.push({
      url, title, kind, author,
      published_at: feedDate(tag(b, ["pubDate", "dc:date", "published", "updated"]), nowMs),
      summary: summaryRaw ? cut(htmlToText(summaryRaw), 4000) || null : null,
      content: contentRaw ? cut(htmlToText(contentRaw), BODY_MAX_CHARS) || null : null,
    });
  }
  return out;
}

// ---- 텔레그램 공개 채널 웹 미리보기(t.me/s/<채널>) ------------------------------------------------------------------
// 로그인 없이 열리는 공개 페이지. 글마다 `data-post="<채널>/<번호>"` 칸, 본문 `div.tgme_widget_message_text`, 날짜 `<time datetime>`.
// 제목은 본문 첫 줄(텔레그램 글엔 제목이 없다). 원문 주소는 글 칸 안 링크 가운데 카탈로그가 허용한 단체 사이트 글 주소(있으면) — 그 주소는 요청하지 않는다.
// 없으면 채널 글 주소(t.me/<채널>/<번호>). 페이지는 옛 글 → 새 글 순이라 뒤집어 새 글부터.
const TG_TITLE_MAX = 120;
export function parseTelegram(source: OutsideSource, html: string, nowMs: number, limit = 30, stats?: ListStats): ListItem[] {
  const ch = source.telegram;
  if (!ch) return [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const marks = [...clean.matchAll(/\bdata-post\s*=\s*"([A-Za-z0-9_]{1,64})\/(\d{1,9})"/g)];
  const posts: { n: string; seg: string }[] = [];
  for (const [i, m] of marks.entries()) {
    if (m[1].toLowerCase() !== ch.toLowerCase()) continue;
    posts.push({ n: m[2], seg: clean.slice(m.index!, marks[i + 1]?.index ?? clean.length) });
  }
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const { n, seg } of posts.reverse()) {
    if (out.length >= limit) break;
    if (stats) stats.candidates++;
    // 본문 칸: 안에 <div>가 없는 칸이라 첫 </div>까지.
    const textHtml = /<div\b[^>]*\bclass\s*=\s*"[^"]*\btgme_widget_message_text\b[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(seg)?.[1] ?? "";
    const text = cut(htmlToText(textHtml), BODY_MAX_CHARS);
    const first = text.split("\n").map((l) => oneLine(l)).find(Boolean) ?? "";
    const title = first ? cleanTitle(cut(first, TG_TITLE_MAX)) : null;
    if (!title) continue; // 사진·파일뿐인 글
    let url: string | null = null;
    for (const h of seg.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)) {
      const raw = decodeEntities(h[1]);
      let u: URL;
      try { u = new URL(raw); } catch { continue; }
      if (u.hostname.toLowerCase() === "t.me" || u.pathname === "/" || !u.pathname) continue;
      url = canonicalUrl(source, raw);
      if (url) break;
    }
    url = url ?? canonicalUrl(source, `https://t.me/${ch}/${n}`);
    if (!url || seen.has(url)) continue;
    const kind = source.kindOf(title, url);
    if (!kind) continue;
    seen.add(url);
    const dt = /<time\b[^>]*\bdatetime\s*=\s*"([^"]+)"/i.exec(seg)?.[1] ?? null;
    out.push({ url, title, kind, author: null, published_at: feedDate(dt, nowMs), summary: null, content: text || null });
  }
  return out;
}

// 피드·목록 대신 '사람인지 확인' 스크립트 쪽이 온 경우(무료 호스팅의 자바스크립트 쿠키 확인 등).
// 이 쪽은 풀지 않는다(우회 금지) — 단체 상태를 bot_check(사이트가 자동 읽기를 막아 둠)로 남길 뿐이다.
export function looksLikeBotCheck(text: string): boolean {
  if (/<(rss|feed|rdf:RDF)\b/i.test(text)) return false;
  return /slowAES|\/aes\.js|\/cupid\.js|__test=|challenge-platform|cf-chl-|Just a moment\.\.\./i.test(text);
}

// ---- 목록 HTML -----------------------------------------------------------------------------------------------------

// 목록 페이지의 <a href> 가운데 카탈로그 글 주소 규칙(item)에 맞는 것만. 같은 글에 링크가 여럿이면 가장 긴 글자를 제목으로.
export function parseListHtml(source: OutsideSource, html: string, base: string, limit = 30, stats?: ListStats, nowMs = Date.now()): ListItem[] {
  if (!source.item) return [];
  const best = new Map<string, string>();
  const dates = new Map<string, string>();
  const order: string[] = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    let raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!raw) continue;
    if (/^\s*javascript:/i.test(raw)) {
      // 글을 스크립트로 여는 목록: 단체가 정한 바꾸기만(없거나 못 바꾸면 버림).
      let baseUrl: URL;
      try { baseUrl = new URL(base); } catch { continue; }
      raw = source.listHref?.(decodeEntities(raw), baseUrl) ?? "";
      if (!raw) continue;
    }
    let abs: string;
    try { abs = new URL(decodeEntities(raw), base).href; } catch { continue; }
    if (!source.item.test(abs)) continue;
    const url = canonicalUrl(source, abs);
    const title = (source.titleAttr ? innerTitleAttr(m[2]) : null) ?? (source.titleClass ? innerTitle(m[2], source.titleClass) : null)
      ?? cleanTitle(m[2]) ?? cleanTitle(/\btitle\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] ?? "");
    if (!url || !title) continue;
    if (!best.has(url)) order.push(url);
    if (len(title) > len(best.get(url) ?? "")) best.set(url, title);
    if (source.dateClass && !dates.has(url)) {
      const d = innerTitle(m[2], source.dateClass);
      const t = d ? textDate(d, nowMs) : null;
      if (t) dates.set(url, t);
    }
  }
  if (stats) stats.candidates += order.length;
  const out: ListItem[] = [];
  for (const url of order) {
    if (out.length >= limit) break;
    const title = best.get(url)!;
    const kind = source.kindOf(title, url);
    if (!kind) continue;
    out.push({ url, title, kind, published_at: dates.get(url) ?? null, author: null, summary: null, content: null });
  }
  return out;
}

// 링크 안 첫 title="…" 값(목록 카드의 그림 title처럼 줄임표 없이 제목 전체가 든 경우, 단체 규칙 titleAttr). 없으면 null.
function innerTitleAttr(inner: string): string | null {
  const m = /\btitle\s*=\s*(?:"([^"]{1,1000})"|'([^']{1,1000})')/i.exec(inner);
  return m ? cleanTitle(m[1] ?? m[2] ?? "") : null;
}

// 링크 안에서 class 이름 하나가 re에 맞는 첫 칸의 글자(같은 이름 닫는 태그까지). 없으면 null.
function innerTitle(inner: string, re: RegExp): string | null {
  const lower = inner.toLowerCase();
  for (const m of inner.matchAll(/<([a-z][a-z0-9]{0,9})\b([^>]*)>/gi)) {
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
    const names = (cls?.[1] ?? cls?.[2] ?? "").split(/\s+/).filter(Boolean);
    if (!names.some((n) => re.test(n))) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end = lower.indexOf(`</${m[1].toLowerCase()}`, start);
    if (end < 0) continue;
    const t = cleanTitle(inner.slice(start, end));
    if (t) return t;
  }
  return null;
}

// ---- 글 본문 ------------------------------------------------------------------------------------------------------

const END_MARK = /^(목록|목록으로|이전글|다음글|윗글|아랫글|이전 글|다음 글|댓글|덧글|관련\s?글|공유하기|SNS 공유|Share this|Related|Comments?|Leave a (reply|comment)|Copyright|ⓒ|©|(수정|삭제)(\s+(수정|삭제|목록))*$)/i;
// 첨부 파일 이름 줄(본문이 그림·한글 파일뿐인 글의 '…성명.hwp' 등)은 본문이 아니다.
const FILE_LINE = /\.(hwpx?|pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|zip)$/i;

// 단체 규칙 bodyClass(class 이름 또는 id 하나가 맞는 칸)의 안쪽 HTML을 모두(같은 이름 칸이 여럿이면 차례로 이어서). 짝 맞는 닫는 태그까지만.
export function bodyBlocks(html: string, re: RegExp): string {
  const parts: string[] = [];
  const open = /<([a-z][a-z0-9]{0,9})\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const attrs = m[2];
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const names = [...(cls?.[1] ?? cls?.[2] ?? "").split(/\s+/), id?.[1] ?? id?.[2] ?? ""].filter(Boolean);
    if (!names.some((n) => re.test(n))) continue;
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const step = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    step.lastIndex = start;
    let depth = 1, end = -1, t: RegExpExecArray | null;
    while ((t = step.exec(html))) {
      if (t[1]) { if (--depth === 0) { end = t.index; break; } }
      else if (!t[0].endsWith("/>")) depth++;
    }
    if (end < 0) end = html.length;
    parts.push(html.slice(start, end));
    open.lastIndex = end;
    if (parts.length >= 20) break;
  }
  return parts.join("\n");
}

// 글 페이지에서 본문 글자만: 단체 규칙 bodyClass 칸 → <article>(또는 흔한 본문 칸) → 페이지 전체 순서. 제목 줄 뒤부터 '목록·이전글·댓글·저작권' 줄 앞까지.
export function extractBody(html: string, title: string, bodyClass?: RegExp): string {
  const own = bodyClass ? bodyBlocks(html, bodyClass) : "";
  const scoped = (own.trim() ? own : null)
    ?? /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(html)?.[1]
    ?? /<(?:div|section)\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:entry-content|post-content|article-body|article_body|view_content|view-content|board_view|bbs_view|xe_content|rd_body|content_view|viewContent|bo_v_con)\b[^"']*["'][^>]*>([\s\S]*)/i.exec(html)?.[1]
    ?? (/<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1] ?? html);
  const cleaned = scoped.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const lines = htmlToText(cleaned).split("\n");
  // 단체 본문 칸 안은 처음부터 본문이다(제목 찾기를 하면 '…규탄한다.hwp' 같은 첨부 이름 줄 뒤부터 읽게 된다).
  const start = own.trim() ? 0 : afterTitle(lines, title);
  const body: string[] = [];
  for (const l of lines.slice(start)) {
    if (END_MARK.test(l)) break;
    if (DATE_ONLY.test(l) || FILE_LINE.test(l)) continue; // 글 머리의 날짜·시각 줄, 첨부 파일 이름 줄은 본문이 아니다
    body.push(l);
  }
  return cut(body.join("\n").trim(), BODY_MAX_CHARS);
}
const DATE_ONLY = /^(?=.*\d)[\d\s.:/\-()년월일시분오전후AMPMampm]+$/;
// 제목 줄 다음 줄 번호(제목을 못 찾으면 0). 머리말([성명] 등)은 빼고 앞 20자로 찾는다.
function afterTitle(lines: string[], title: string): number {
  const key = oneLine(title).replace(/^\s*[\[<(【〈「][^\]>)】〉」]{1,20}[\]>)】〉」]\s*/, "").slice(0, 20);
  const i = key ? lines.findIndex((l) => l.includes(key)) : -1;
  return i < 0 ? 0 : i + 1;
}
// 글 페이지의 게시 날짜: 제목 줄 뒤 15줄 안에서 처음 나오는 날짜(제목을 못 찾으면 페이지 앞에서).
export function pageDate(html: string, title: string, nowMs: number): string | null {
  const lines = htmlToText(html).split("\n");
  const start = afterTitle(lines, title);
  return textDate(lines.slice(start, start + 15).join("\n"), nowMs);
}

// 문장 나누기: 문단(줄) → 문장 끝(. ! ? … 。 다음 빈칸)으로. 500자 넘는 문장은 잘라 여러 줄로. 3001개까지.
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const p = oneLine(para);
    if (!p) continue;
    for (const s of p.split(/(?<=[.!?…。])\s+(?=\S)/)) {
      let rest = s.trim();
      while (rest) {
        const chars = [...rest];
        if (chars.length <= SENTENCE_MAX_CHARS) { out.push(rest); break; }
        out.push(chars.slice(0, SENTENCE_MAX_CHARS).join(""));
        rest = chars.slice(SENTENCE_MAX_CHARS).join("").trim();
      }
      if (out.length >= SENTENCE_MAX_COUNT) return out.slice(0, SENTENCE_MAX_COUNT);
    }
  }
  return out;
}

// ---- robots.txt ---------------------------------------------------------------------------------------------------

type Rule = { allow: boolean; path: string };
// 우리 이름(agent)에 맞는 묶음이 있으면 그것, 없으면 '*' 묶음. 가장 긴 규칙이 이긴다(같으면 Allow).
export function robotsAllows(robots: string, agent: string, path: string): boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && cur) {
      lastWasAgent = false;
      if (value) cur.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const me = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!pathMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* 그대로 */ }
  return re.test(path) || re.test(decoded);
}

// 응답 글자 해석(charset: 헤더 → <meta> → utf-8). 한국 게시판의 euc-kr도 읽는다.
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const pick = (s: string | null | undefined) => {
    const c = s?.trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!c) return null;
    if (/^(utf-?8)$/.test(c)) return "utf-8";
    if (/^(euc-?kr|ks_c_5601-1987|cp949|x-windows-949|windows-949)$/.test(c)) return "euc-kr";
    if (/^(iso-8859-1|latin1|windows-1252|us-ascii)$/.test(c)) return "windows-1252";
    return null;
  };
  let enc = pick(/charset\s*=\s*([^;]+)/i.exec(contentType ?? "")?.[1]);
  if (!enc) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 4096));
    enc = pick(/<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(head)?.[1]) ?? pick(/<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_-]+)/i.exec(head)?.[1]);
  }
  try { return new TextDecoder(enc ?? "utf-8").decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}
