// 바깥 성명 카탈로그(OUTSIDE-바깥성명 ③, 설계 docs/design/outside-statements.md 1·3.2절, 8절 결정).
// 서버(outside-feed)가 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고, 키(source_key)만 고른다(SSRF 차단).
// - hosts: 이 단체에서 요청해도 되는 호스트(목록·글·robots.txt·리다이렉트 모두 이 안에서만).
// - allowHttp: http 주소 허용(Q4 결정: socialist.kr 하나만). 나머지는 https만.
// - item: 목록 HTML에서 글 주소로 볼 링크(절대 주소 기준). canon: 같은 글의 주소를 하나로(쪽 번호 같은 군더더기 빼기).
// - kindOf: 제목·주소로 종류(statement|comment|press|article)를 정한다. null이면 성명 게시판의 다른 글(공지·취재요청 등)이라 넣지 않는다.
// 빠진 것(결정): 정의당(Q1, robots.txt가 막음 — 자동 수집 안 함), NLR(Q5, 유료), In These Times·The Nation·Tribune·Spectre(Q5).
// 새 단체는 여기에 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).

export type Kind = "statement" | "comment" | "press" | "article";
export type Group = "kctu" | "kptu" | "party" | "movement" | "foreign";
export type OutsideSource = {
  key: string;
  name: string;
  group: Group;
  lang: "ko" | "en";
  mode: "rss" | "html";
  lists: string[];
  hosts: string[];
  allowHttp?: boolean;
  item?: RegExp;
  canon?: (url: URL) => string;
  kindOf: (title: string, url: string) => Kind | null;
};

// 제목 머리말([성명]·<논평>·【보도자료】 등)로 종류를 정한다. 머리말이 없으면 fallback.
const PREFIX = /^\s*[\[<(【〈「]\s*([^\]>)】〉」]{1,20}?)\s*[\]>)】〉」]/;
export function prefixOf(title: string): string {
  const m = PREFIX.exec(title);
  return m ? m[1].replace(/\s+/g, "") : "";
}
function byPrefix(fallback: Kind | null, skip: RegExp | null = /취재요청|취재\s*요청|공지|안내|모집|초대|일정|부고|알림/) {
  return (title: string): Kind | null => {
    const p = prefixOf(title);
    if (skip && p && skip.test(p)) return null;
    if (/성명|입장/.test(p)) return "statement";
    if (/논평|브리핑|발언/.test(p)) return "comment";
    if (/보도자료|기자회견/.test(p)) return "press";
    return fallback;
  };
}
// 쿼리 값 몇 개만 남긴 주소(같은 글이 쪽 번호만 달라 두 번 들어오지 않게).
function keepQuery(keys: string[]) {
  return (u: URL) => {
    const q = new URLSearchParams();
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v !== null) q.set(k, v);
    }
    const s = q.toString();
    return `${u.protocol}//${u.host}${u.pathname}${s ? `?${s}` : ""}`;
  };
}
const plain = (u: URL) => `${u.protocol}//${u.host}${u.pathname}`;

export const OUTSIDE_CATALOG: readonly OutsideSource[] = Object.freeze([
  {
    key: "kctu", name: "민주노총", group: "kctu", lang: "ko", mode: "html",
    lists: ["https://nodong.org/statement"], hosts: ["nodong.org", "www.nodong.org"],
    item: /^https:\/\/(www\.)?nodong\.org\/statement\/\d+\/?$/, canon: plain,
    kindOf: byPrefix("statement"),
  },
  {
    key: "kptu", name: "공공운수노조", group: "kptu", lang: "ko", mode: "html",
    lists: ["https://www.kptu.net/board/list.aspx?mid=F686C1F3"], hosts: ["www.kptu.net", "kptu.net"],
    item: /^https:\/\/(www\.)?kptu\.net\/board\/detail\.aspx\?(?=[^#]*\bmid=F686C1F3\b)(?=[^#]*\bidx=\d+\b)/i,
    canon: keepQuery(["mid", "idx"]),
    kindOf: byPrefix("statement"),
  },
  {
    key: "laborparty", name: "노동당", group: "party", lang: "ko", mode: "html",
    lists: ["https://laborparty.kr/?page_id=13642"], hosts: ["laborparty.kr", "www.laborparty.kr"],
    item: /^https:\/\/(www\.)?laborparty\.kr\/\?(?=[^#]*\bmod=document\b)(?=[^#]*\bpage_id=13642\b)(?=[^#]*\buid=\d+\b)/,
    canon: keepQuery(["mod", "page_id", "uid"]),
    kindOf: byPrefix("comment"),
  },
  {
    key: "kgreens", name: "녹색당", group: "party", lang: "ko", mode: "html",
    lists: ["https://kgreens.org/statement", "https://kgreens.org/press"], hosts: ["kgreens.org", "www.kgreens.org"],
    item: /^https:\/\/(www\.)?kgreens\.org\/(statement|press)\/?\?(?=[^#]*\bbmode=view\b)(?=[^#]*\bidx=\d+\b)/,
    canon: keepQuery(["bmode", "idx"]),
    kindOf: (title, url) => byPrefix(/\/press\/?\?/.test(url) ? "press" : "comment")(title),
  },
  {
    key: "jinboparty", name: "진보당", group: "party", lang: "ko", mode: "html",
    lists: ["https://jinboparty.com/pages/?p=15&b=b_1_2", "https://jinboparty.com/pages/?p=286&b=b_1_111"],
    hosts: ["jinboparty.com", "www.jinboparty.com"],
    item: /^https:\/\/(www\.)?jinboparty\.com\/pages\/(index\.php)?\?(?=[^#]*\bb=b_1_(2|111)\b)(?=[^#]*\b(bn|idx|no)=\d+\b)/,
    canon: keepQuery(["p", "b", "bn", "idx", "no"]),
    kindOf: (title, url) => byPrefix(/\bb=b_1_111\b/.test(url) ? "press" : "comment")(title),
  },
  {
    key: "pssp", name: "사회진보연대", group: "movement", lang: "ko", mode: "html",
    lists: ["https://pssp.org/bbs/list.php?board=statement"], hosts: ["pssp.org", "www.pssp.org"],
    item: /^https:\/\/(www\.)?pssp\.org\/bbs\/view\.php\?(?=[^#]*\bboard=statement\b)(?=[^#]*\b(id|no|idx)=\d+\b)/,
    canon: keepQuery(["board", "id", "no", "idx"]),
    kindOf: byPrefix("statement"),
  },
  {
    // 신문 기사와 성명이 한 피드에 섞여 있어 제목 머리말에 '성명'이 있는 글만 넣는다.
    key: "ws", name: "노동자연대", group: "movement", lang: "ko", mode: "rss",
    lists: ["https://ws.or.kr/feed"], hosts: ["ws.or.kr", "www.ws.or.kr"],
    canon: plain,
    kindOf: (title) => (/성명/.test(prefixOf(title)) ? "statement" : null),
  },
  {
    key: "platformc", name: "플랫폼C", group: "movement", lang: "ko", mode: "html",
    lists: ["https://platformc.kr/readings/"], hosts: ["platformc.kr", "www.platformc.kr"],
    item: /^https:\/\/(www\.)?platformc\.kr\/\d{4}\/\d{2}\/[^/?#]+\/?$/, canon: plain,
    kindOf: byPrefix("article"),
  },
  {
    // 성명 게시판이 없고 공지사항에 [입장] 머리말로 올라온다(Q3). [입장]만 성명으로 넣는다(공지·토론회 안내는 거름).
    key: "leftall", name: "전국결집", group: "movement", lang: "ko", mode: "html",
    lists: ["https://leftall.com/bbs/board.php?bo_table=notice"], hosts: ["leftall.com", "www.leftall.com"],
    item: /^https:\/\/(www\.)?leftall\.com\/(notice\/\d+\/?$|bbs\/board\.php\?(?=[^#]*\bbo_table=notice\b)(?=[^#]*\bwr_id=\d+\b))/,
    canon: (u) => {
      const id = u.searchParams.get("wr_id") ?? /\/notice\/(\d+)/.exec(u.pathname)?.[1] ?? "";
      return `https://leftall.com/notice/${id}`;
    },
    kindOf: (title) => (/입장/.test(prefixOf(title)) ? "statement" : null),
  },
  {
    key: "socialism", name: "사회주의를향한전진", group: "movement", lang: "ko", mode: "html",
    lists: ["https://socialism.jinbo.net/bbs/board.php?bo_table=news&me_id=11&me_code=20"], hosts: ["socialism.jinbo.net"],
    item: /^https:\/\/socialism\.jinbo\.net\/bbs\/board\.php\?(?=[^#]*\bbo_table=news\b)(?=[^#]*\bwr_id=\d+\b)/,
    canon: keepQuery(["bo_table", "wr_id"]),
    kindOf: byPrefix("statement"),
  },
  {
    // https 없이만 열린다(Q4 결정: 이 단체만 http 허용).
    key: "socialist", name: "사회주의자", group: "movement", lang: "ko", mode: "rss",
    lists: ["http://socialist.kr/feed"], hosts: ["socialist.kr", "www.socialist.kr"], allowHttp: true,
    canon: plain,
    kindOf: byPrefix("article"),
  },
  // 외국 매체(Q5): 제목·링크·한국어 요약·핵심 문장 3개까지만 저장한다(본문·전문 번역 저장 안 함, 2절).
  {
    key: "jacobin", name: "Jacobin", group: "foreign", lang: "en", mode: "rss",
    lists: ["https://jacobin.com/rss"], hosts: ["jacobin.com", "www.jacobin.com"], canon: plain, kindOf: () => "article",
  },
  {
    key: "labornotes", name: "Labor Notes", group: "foreign", lang: "en", mode: "rss",
    lists: ["https://labornotes.org/feed"], hosts: ["labornotes.org", "www.labornotes.org"], canon: plain, kindOf: () => "article",
  },
  {
    key: "redpepper", name: "Red Pepper", group: "foreign", lang: "en", mode: "rss",
    lists: ["https://www.redpepper.org.uk/feed/"], hosts: ["www.redpepper.org.uk", "redpepper.org.uk"], canon: plain, kindOf: () => "article",
  },
  {
    key: "socialistworker", name: "Socialist Worker", group: "foreign", lang: "en", mode: "rss",
    lists: ["https://socialistworker.co.uk/feed/"], hosts: ["socialistworker.co.uk", "www.socialistworker.co.uk"], canon: plain, kindOf: () => "article",
  },
] as OutsideSource[]);

export const OUTSIDE_SOURCE_KEYS = OUTSIDE_CATALOG.map((s) => s.key);
export function sourceByKey(key: unknown): OutsideSource | null {
  return typeof key === "string" ? OUTSIDE_CATALOG.find((s) => s.key === key) ?? null : null;
}

// 이 단체가 요청해도 되는 주소인지: 카탈로그 호스트 + https(또는 이 단체만 http) + 기본 포트 + 사용자 정보 없음.
export function allowedUrl(source: OutsideSource, raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && source.allowHttp)) return null;
  if (u.username || u.password || u.port) return null;
  if (!source.hosts.includes(u.hostname.toLowerCase())) return null;
  return u;
}

// 화면에 돌려주는 모양(주소·규칙은 싣지 않음).
export function publicCatalog() {
  return OUTSIDE_CATALOG.map(({ key, name, group, lang }) => ({ key, name, group, lang }));
}
