// 일회용 조사(S50-32). GET만, 비밀값 없음. 실제 수집 코드(parse.ts·카탈로그)로 단체마다 목록 첫 쪽의 최신 날짜를 본다.
const P = await import("../supabase/functions/outside-feed/parse.ts");
const C = await import("../supabase/functions/_shared/outside-catalog.ts");
const H = { USER_AGENT: "Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)", AGENT: "Web2OutsideFeed" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.now();
async function get(url, accept = "text/html") {
  try {
    const r = await fetch(url, { headers: { "User-Agent": H.USER_AGENT, Accept: accept, "Accept-Language": "ko,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const buf = new Uint8Array(await r.arrayBuffer()); await sleep(1200);
    return { status: r.status, url: r.url, text: new TextDecoder("utf-8").decode(buf) };
  } catch (e) { await sleep(1200); return { err: String(e) }; }
}
const robotsCache = new Map();
async function allowed(u, key) {
  if (["kptu", "laborparty"].includes(key)) return true;
  const o = new URL(u).origin;
  if (!robotsCache.has(o)) { const r = await get(o + "/robots.txt", "text/plain"); robotsCache.set(o, r.status === 200 ? r.text : r.status >= 400 && r.status < 500 && r.status !== 403 ? "" : null); }
  const t = robotsCache.get(o); if (t === null) return false;
  return P.robotsAllows(t, H.AGENT, new URL(u).pathname + new URL(u).search);
}
const kst = (s) => (s ? new Date(Date.parse(s) + 9 * 3600000).toISOString().slice(0, 10) : "null");
function summarize(src, list, got) {
  const items = src.mode === "rss" ? P.parseFeed(src, got.text, NOW, 30) : src.mode === "telegram" ? P.parseTelegram(src, got.text, NOW, 30) : P.parseListHtml(src, got.text, got.url, 30, undefined, NOW);
  const dated = items.filter((i) => i.published_at).map((i) => i.published_at).sort();
  console.log(`== ${src.key} ${list} status=${got.status} items=${items.length} dated=${dated.length} newest=${kst(dated.at(-1))} oldest=${kst(dated[0])}`);
  for (const i of items.slice(0, 4)) console.log(`   ${kst(i.published_at)} ${i.kind} ${i.url}`);
  return items;
}
for (const src of C.OUTSIDE_CATALOG) {
  for (const list of src.lists) {
    if (!(await allowed(list, src.key))) { console.log(`== ${src.key} robots_denied`); continue; }
    const got = await get(list, src.mode === "rss" ? "application/rss+xml, application/xml, text/xml" : "text/html");
    if (!got.text) { console.log(`== ${src.key} ${list} ${got.status ?? got.err}`); continue; }
    const items = summarize(src, list, got);
    // 목록에 날짜가 없으면 첫 글 쪽을 읽어 글 쪽 날짜를 본다(글 1건만).
    if (items.length && !items[0].published_at && src.mode === "html") {
      const pg = await get(items[0].url);
      if (pg.text) console.log(`   page0 date=${kst(P.pageDate(pg.text, items[0].title, NOW, src.bodyClass))}`);
    }
  }
}
// 사회진보연대 다른 게시판(공지)의 첫 쪽 모양.
for (const board of ["notice", "focus"]) {
  const u = `https://pssp.org/bbs/list.php?board=${board}`;
  const got = await get(u);
  console.log(`== pssp-board ${board} status=${got.status} bytes=${got.text?.length}`);
  const t = got.text || "";
  const re = new RegExp(`<tr\\b[\\s\\S]*?view\\.php\\?board=${board}[\\s\\S]*?<\\/tr>`, "g");
  let n = 0;
  for (const m of t.matchAll(re)) { if (n++ >= 25) break; console.log("   ROW " + JSON.stringify(m[0].replace(/\s+/g, " ").replace(/<(?!a\b|\/a)[^>]*>/g, "|").replace(/\|+/g, "|").slice(0, 400))); }
  if (!n) { const i = t.indexOf(`board=${board}&`); console.log("   RAW " + JSON.stringify(t.slice(Math.max(0, i - 600), i + 1500).replace(/\s+/g, " "))); }
  if (board === "notice") {
    const m = /view\.php\?board=notice&(?:amp;)?nid=(\d+)/.exec(t);
    if (m) { const pg = await get(`https://pssp.org/bbs/view.php?board=notice&nid=${m[1]}`); const x = pg.text || ""; const k = x.search(/\d{4}[-.]\d{2}[-.]\d{2}/); console.log(`   VIEW ${pg.status} date-near ${JSON.stringify(x.slice(Math.max(0, k - 300), k + 200).replace(/\s+/g, " "))}`); }
  }
}
