// 글자 풀기(HTML 엔티티) 공용 한 곳(S52-38 NEWS-글자표기깨짐). 순수 함수, 네트워크·DB 없음.
// 쓰는 곳: outside-feed/parse.ts(피드·목록·텔레그램 제목·요약·본문 글자), news-feed/page.ts(기사 쪽 제목·메타),
//          _shared/outside-tidy.ts(제목·요약 정돈, 글 쪽 제목), _shared/feed-extract.ts(사진 대체 글·캡션).
// 결과는 언제나 '글자'다. 풀린 '<b>' 같은 글자를 태그로 다시 살리지 않는다(화면은 글자로만 그린다).
//
// 네 가지를 푼다.
// 1) 이름·숫자 표기: &quot; &middot; &hellip; &lsquo; &rsquo; &#39; &#x27; …
// 2) 두 번(세 번) 감싼 표기: &amp;quot; → &quot; → "   (decodeEntitiesDeep, 바뀌지 않을 때까지 최대 9번)
// 3) '&'가 빠진 채 온 표기: 'quot;'·'middot;'·'hellip;'·'#39;' (repairBareEntities)
//    프레시안 RSS(/api/v3/site/rss/news)는 제목의 따옴표·가운뎃점·말줄임표를 '&' 없이 'quot;'·'middot;'·'hellip;'로 보낸다
//    (11/08 요청함 캡처 3장, 피드 원문 확인 — 같은 글의 description은 정상 따옴표). 수집기 잘못이 아니라 피드 글자 자체라서
//    한 번 더 푸는 것으로는 고쳐지지 않는다. 그래서 아래 정해진 낱말만, 앞 글자가 영문·숫자·'&'가 아닐 때만 되살린다
//    ('Volt;'·'camp;' 같은 낱말 끝은 건드리지 않는다). 이 규칙은 DB 옛 글 고침(20261108010000_feed_entity_text_fix)과 같다.
// 4) ';'가 빠진 흔한 이름 표기: '&middot'·'&rarr'·'&nbsp' (decodeLooseEntities, S61-37)

// 이름 표기(자주 쓰는 것 전부). 모르는 이름은 그대로 둔다.
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  middot: "·", bull: "•", hellip: "…", ndash: "–", mdash: "—", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  prime: "′", Prime: "″", copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷",
  sect: "§", para: "¶", dagger: "†", Dagger: "‡", permil: "‰", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  euro: "€", pound: "£", yen: "¥", cent: "¢", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  iexcl: "¡", iquest: "¿", shy: "", zwj: "", zwnj: "", lrm: "", rlm: "",
};
const NAMED_LOWER: Record<string, string> = Object.fromEntries(Object.entries(NAMED).map(([k, v]) => [k.toLowerCase(), v]));

function codePoint(e: string): string {
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  // 제어 문자·잘못된 번호는 빈칸(글자 칸에 제어 문자를 남기지 않는다). 탭·줄바꿈은 그대로.
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return " ";
  if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 0x7f && n <= 0x9f)) return " ";
  return String.fromCodePoint(n);
}

// 한 번 풀기. 주소·속성값처럼 '한 번만' 풀어야 하는 곳은 이것을 쓴다.
export function decodeEntities(s: string): string {
  return String(s ?? "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,7});/gi, (m, e: string) => {
    if (e[0] === "#") return codePoint(e);
    return NAMED[e] ?? NAMED_LOWER[e.toLowerCase()] ?? m;
  });
}

// 바뀌지 않을 때까지(최대 9번) 풀기: 두 번·세 번 감싼 표기(&amp;quot;·&amp;amp;quot;·&#38;quot;). DB 고침 SQL은 '&'를 만드는 표기(amp·#38)를 8번 되풀이해 같은 결과를 낸다.
export function decodeEntitiesDeep(s: string, max = 9): string {
  let t = String(s ?? "");
  for (let i = 0; i < max && t.includes("&"); i++) {
    const next = decodeEntities(t);
    if (next === t) break;
    t = next;
  }
  return t;
}

// '&'가 빠진 표기. 낱말·숫자 목록과 앞 글자 조건은 DB 고침 SQL과 같다(시험이 대조한다).
export const BARE_NAMED: ReadonlyArray<readonly [string, string]> = [
  ["quot", '"'], ["apos", "'"], ["amp", "&"], ["lt", "<"], ["gt", ">"], ["nbsp", " "],
  ["middot", "·"], ["hellip", "…"], ["lsquo", "‘"], ["rsquo", "’"], ["ldquo", "“"], ["rdquo", "”"],
  ["ndash", "–"], ["mdash", "—"], ["laquo", "«"], ["raquo", "»"], ["bull", "•"],
];
export const BARE_NUMERIC: ReadonlyArray<readonly [string, string]> = [
  ["#39", "'"], ["#039", "'"], ["#x27", "'"], ["#34", '"'], ["#034", '"'], ["#x22", '"'], ["#38", "&"], ["#038", "&"],
  ["#183", "·"], ["#8216", "‘"], ["#8217", "’"], ["#8220", "“"], ["#8221", "”"], ["#8230", "…"], ["#8211", "–"], ["#8212", "—"], ["#160", " "],
];
const BARE = new Map<string, string>([...BARE_NAMED, ...BARE_NUMERIC]);
const alt = (list: ReadonlyArray<readonly [string, string]>) => list.map(([k]) => k).sort((a, b) => b.length - a.length).join("|");
// 이름: 앞 글자가 영문·숫자·'&'가 아닐 때만('Volt;'·'camp;' 제외). 앞에 붙은 'amp;'(두 번 감싼 표기에서 '&'만 빠진 꼴)는 함께 먹는다.
// 숫자('#39;'): 모양이 뚜렷해서 앞 글자가 '&'만 아니면 된다('It#39;s' → "It's").
const BARE_NAMED_RE = new RegExp(`(?<![A-Za-z0-9&])(?:amp;)*(${alt(BARE_NAMED)});`, "g");
const BARE_NUMERIC_RE = new RegExp(`(?<!&)(?:amp;)*(${alt(BARE_NUMERIC)});`, "g");
export function repairBareEntities(s: string): string {
  const get = (m: string, e: string) => BARE.get(e) ?? m;
  return String(s ?? "").replace(BARE_NUMERIC_RE, get).replace(BARE_NAMED_RE, get);
}

// ';'가 빠진 이름 표기(S61-37 NEWS-원문표기깨짐2): '&middot 안전'·'4 급 &rarr 3 급'처럼 끝 ';' 없이 오는 표기.
// 공공운수노조 보도자료(한글 문서를 붙여 넣은 HTML)가 이런 꼴로 온다(11/13 요청함 캡처). 브라우저도 흔한 이름은 ';' 없이 푼다.
// 정해진 이름만, '&'가 붙어 있고 바로 뒤가 영문·숫자·';'·'='가 아닐 때만 푼다('&copyright'·'?a=1&lt=2' 같은 주소·낱말은 그대로).
// 대소문자는 그대로 맞춘다(이름 표기는 대소문자를 가린다). 주소·속성값에는 쓰지 않는다(글자 칸만, decodeText 안에서만).
export const LOOSE_NAMED: ReadonlyArray<string> = [
  "amp", "lt", "gt", "quot", "apos", "nbsp", "middot", "hellip", "bull", "rarr", "larr", "uarr", "darr",
  "lsquo", "rsquo", "ldquo", "rdquo", "ndash", "mdash", "laquo", "raquo", "copy", "reg", "trade", "deg", "times",
];
const LOOSE_RE = new RegExp(`&(${[...LOOSE_NAMED].sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z0-9;=])`, "g");
export function decodeLooseEntities(s: string): string {
  return String(s ?? "").replace(LOOSE_RE, (m, e: string) => NAMED[e] ?? m);
}

// 표시 글자로: 끝까지 풀고(';' 빠진 흔한 이름 표기 포함) → '&' 빠진 표기 되살리기. 제목·요약·본문 글자·대체 글처럼 '글자로만' 쓰는 칸에 쓴다.
// 두 번 감싼 ';' 없는 표기('&amp;middot ')도 풀리도록 한 겹 풀 때마다 ';' 없는 표기도 함께 본다(바뀌지 않을 때까지 최대 9번).
export function decodeText(s: string): string {
  let t = String(s ?? "");
  for (let i = 0; i < 9 && t.includes("&"); i++) {
    const next = decodeLooseEntities(decodeEntities(t));
    if (next === t) break;
    t = next;
  }
  return repairBareEntities(t);
}
