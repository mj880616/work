// 일회용 조사 2차(S50-32). GET만. 사회진보연대 공지·성명 게시판 목록 줄 원문 HTML 몇 줄.
const UA = "Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const r = await fetch("https://pssp.org/bbs/list.php?board=notice", { headers: { "User-Agent": UA, Accept: "text/html" } });
const t = await r.text();
console.log("status", r.status, "url", r.url);
const i = t.indexOf("view.php?board=notice");
console.log("RAW1 " + JSON.stringify(t.slice(Math.max(0, i - 900), i + 2600)));
const j = t.indexOf("nid=83634");
console.log("RAW2 " + JSON.stringify(t.slice(Math.max(0, j - 400), j + 900)));
const k = t.lastIndexOf("view.php?board=notice");
console.log("RAW3 " + JSON.stringify(t.slice(k - 300, k + 1200)));
const v = await fetch("https://pssp.org/bbs/view.php?board=notice&nid=83634", { headers: { "User-Agent": UA, Accept: "text/html" } });
const vt = await v.text();
console.log("VIEW meta " + JSON.stringify([...vt.matchAll(/<meta[^>]+>/g)].map((m) => m[0]).filter((m) => /time|title|date/i.test(m))));
