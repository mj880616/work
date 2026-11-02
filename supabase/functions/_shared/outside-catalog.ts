// 바깥 성명 카탈로그(OUTSIDE-바깥성명 ③, 설계 docs/design/outside-statements.md 1·3.2절, 8절 결정).
// 서버(outside-feed)가 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고, 키(source_key)만 고른다(SSRF 차단).
// - hosts: 이 단체에서 요청해도 되는 호스트(목록·글·robots.txt·리다이렉트 모두 이 안에서만).
// - httpHosts: http 주소를 허용하는 호스트(Q4 결정: socialist.kr 하나만 — 텔레그램 글 안 원문 링크용). 나머지 호스트는 https만.
// - item: 목록 HTML에서 글 주소로 볼 링크(절대 주소 기준). canon: 같은 글의 주소를 하나로(쪽 번호 같은 군더더기 빼기).
// - kindOf: 제목·주소로 종류(statement|comment|press|article)를 정한다. null이면 성명 게시판의 다른 글(공지·취재요청 등)이라 넣지 않는다.
// 빠진 것(결정): 정의당(Q1, robots.txt가 막음 — 자동 수집 안 함), NLR(Q5, 유료), In These Times·The Nation·Tribune·Spectre(Q5).
// 새 단체는 여기에 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).

export type Kind = "statement" | "comment" | "press" | "article";
// 묶음 칩(11/02 00:19 명진 요청): [노동] [정당] [사회운동] [외국]. 민주노총·공공운수노조는 [노동] 안 단체 칩.
export type Group = "labor" | "party" | "movement" | "foreign";
export type OutsideSource = {
  key: string;
  name: string;
  group: Group;
  lang: "ko" | "en";
  mode: "rss" | "html" | "telegram";
  lists: string[];
  hosts: string[];
  httpHosts?: string[];
  // mode=telegram: 공개 채널 웹 미리보기(t.me/s/<채널>)의 채널 이름. 글마다 t.me/<채널>/<번호>, 본문 안에 단체 사이트 글 주소가 있으면 그 주소를 원문으로.
  telegram?: string;
  item?: RegExp;
  canon?: (url: URL) => string;
  // 목록이 글을 `javascript:` 링크로 여는 단체: 그 링크를 글 주소로 바꾼다(못 바꾸면 null). 바꾼 주소도 item·hosts 검사를 그대로 받는다.
  listHref?: (href: string, base: URL) => string | null;
  // 목록 링크 안에 제목 칸이 따로 있는 단체: 이 class 이름을 가진 칸의 글자만 제목으로(좋아요 수·요약 같은 덧글자 빼기).
  titleClass?: RegExp;
  // 목록 링크 안 title="…" 값을 제목으로(카드 제목 칸은 줄임표로 잘려 있고 그림 title에 제목 전체가 있는 단체).
  titleAttr?: boolean;
  // 목록 링크 안 날짜 칸(class 이름) — 글 쪽 머리의 '최종편집' 같은 다른 날짜를 게시일로 잘못 읽지 않게.
  dateClass?: RegExp;
  // 글 쪽 본문 칸(class 이름 또는 id). 맞는 칸의 안쪽만 본문으로 읽는다(없거나 비면 흔한 본문 칸·<article>·페이지 전체 순서).
  bodyClass?: RegExp;
  // robots.txt 예외(명진 결정 기록). 이 칸만으로는 효과가 없고, outside-feed handler의 ROBOTS_EXEMPT_KEYS에도 같은 키가 있어야 한다(둘 다 kptu·laborparty 두 곳뿐 — 시험이 고정).
  robotsException?: string;
  kindOf: (title: string, url: string) => Kind | null;
};

// 제목 머리말([성명]·<논평>·【보도자료】 등)로 종류를 정한다. 머리말이 없으면 fallback.
const PREFIX = /^\s*[\[<(【〈「]\s*([^\]>)】〉」]{1,20}?)\s*[\]>)】〉」]/;
export function prefixOf(title: string): string {
  const m = PREFIX.exec(title);
  return m ? m[1].replace(/\s+/g, "") : "";
}
// 머리말이 없어도 제목만 보면 성명이 아닌 안내 글(주간 홍보 일정·취재요청서 양식 등, 2026-11-01 목록 확인)은 넣지 않는다.
const NOTICE_TITLE = /^\s*■|주간\s*홍보\s*일정|취재\s*요청서?\s*양식/;
function byPrefix(fallback: Kind | null, skip: RegExp | null = /취재요청|취재\s*요청|공지|안내|모집|초대|일정|부고|알림|홍보/) {
  return (title: string): Kind | null => {
    const p = prefixOf(title);
    if (skip && p && skip.test(p)) return null;
    if (skip && NOTICE_TITLE.test(title)) return null;
    if (/성명|입장/.test(p)) return "statement";
    if (/논평|브리핑|발언/.test(p)) return "comment";
    if (/보도자료|기자회견/.test(p)) return "press";
    return fallback;
  };
}
// 노동자연대: 괄호 없는 머리말('노동자연대 성명:', '노동자연대 학생그룹 성명 —').
const WS_BARE_STATEMENT = /^\s*노동자\s?연대(\s?학생그룹)?\s?성명\s*[:：\-–—|]/;
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
// 진보당 목록의 `javascript:js_board_view('번호')`(사이트 board.js: 목록 폼에 bn=번호·m=read를 넣어 GET으로 다시 보냄)
// → 같은 게시판의 글 주소 `/pages/?p=..&b=..&bn=번호&m=read`. p·b는 목록 주소의 값을 쓴다.
function jinboView(href: string, base: URL): string | null {
  const m = /^javascript:\s*js_board_view\(\s*['"]?(\d{1,10})['"]?\s*\)\s*;?\s*$/i.exec(href.trim());
  const p = base.searchParams.get("p"), b = base.searchParams.get("b");
  if (!m || !p || !b || !/^\d{1,6}$/.test(p) || !/^b_\d{1,4}_\d{1,4}$/.test(b)) return null;
  return `${base.protocol}//${base.host}/pages/?p=${p}&b=${b}&bn=${m[1]}&m=read`;
}

export const OUTSIDE_CATALOG: readonly OutsideSource[] = Object.freeze([
  {
    key: "kctu", name: "민주노총", group: "labor", lang: "ko", mode: "html",
    lists: ["https://nodong.org/statement"], hosts: ["nodong.org", "www.nodong.org"],
    item: /^https:\/\/(www\.)?nodong\.org\/statement\/\d+\/?$/, canon: plain,
    kindOf: byPrefix("statement"),
  },
  {
    // robots.txt가 모든 자동 읽기를 막지만(`User-agent: *` `Disallow: /`) 명진 결정 11/01 16:49로 이 단체만 읽는다:
    // 명진이 소속된 노조의 공개 성명 게시판. 하루 3번 예약 때 목록 한 쪽 + 새 글만(바로 읽기 없음), 요청 머리(User-Agent)는 그대로.
    // 다른 단체의 robots 규칙은 그대로 지킨다. 2026-11-01 확인: 글 본문은 `div.publishList_write` 안(ASP.NET form 안쪽).
    key: "kptu", name: "공공운수노조", group: "labor", lang: "ko", mode: "html",
    robotsException: "명진 결정 11/01 16:49",
    lists: ["https://www.kptu.net/board/list.aspx?mid=F686C1F3"], hosts: ["www.kptu.net", "kptu.net"],
    bodyClass: /^publishList_write$/,
    item: /^https:\/\/(www\.)?kptu\.net\/board\/detail\.aspx\?(?=[^#]*\bmid=F686C1F3\b)(?=[^#]*\bidx=\d+\b)/i,
    canon: keepQuery(["mid", "idx"]),
    kindOf: byPrefix("statement"),
  },
  {
    // robots.txt 요청을 사이트가 거절해(401·403 → robots_denied, 2026-11-01 20:3x 운영 실행) 명진 결정 11/01 21:08로 이 단체도 읽는다:
    // 공공운수노조 예외와 똑같이 하루 3번 예약 때 목록 한 쪽 + 새 글만(바로 읽기 없음), 요청 머리(User-Agent)는 그대로.
    // 다른 단체의 robots 규칙은 그대로 지킨다.
    key: "laborparty", name: "노동당", group: "party", lang: "ko", mode: "html",
    robotsException: "명진 결정 11/01 21:08",
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
    // 2026-11-01 목록 확인: 글 링크가 `javascript:js_board_view('번호')`라 주소로 바꿔 읽는다(listHref). 제목은 링크 안 제목 칸만
    // (논평 `p.title`, 보도자료 `h4._tit`) — 같은 링크 안의 '좋아요 n'·요약 글자를 빼려고. 글 주소에는 m=read가 있어야 글이 열린다.
    item: /^https:\/\/(www\.)?jinboparty\.com\/pages\/(index\.php)?\?(?=[^#]*\bb=b_1_(2|111)\b)(?=[^#]*\b(bn|idx|no)=\d+\b)/,
    canon: keepQuery(["p", "b", "bn", "m", "idx", "no"]),
    listHref: jinboView,
    titleClass: /^(title|_tit)$/,
    // 2026-11-01 글 쪽 확인: 본문은 `div.content_box` 안(앞 머리 칸에는 작성자·등록일·좋아요만 있다).
    bodyClass: /^content_box$/,
    kindOf: (title, url) => byPrefix(/\bb=b_1_111\b/.test(url) ? "press" : "comment")(title),
  },
  {
    key: "pssp", name: "사회진보연대", group: "movement", lang: "ko", mode: "html",
    lists: ["https://pssp.org/bbs/list.php?board=statement"], hosts: ["pssp.org", "www.pssp.org"],
    // 글 번호는 nid(2026-11-01 목록 확인: `./view.php?board=statement&nid=번호&page=1`). 옛 모양(id·no·idx)도 받는다.
    item: /^https:\/\/(www\.)?pssp\.org\/bbs\/view\.php\?(?=[^#]*\bboard=statement\b)(?=[^#]*\b(nid|id|no|idx)=\d+\b)/,
    canon: keepQuery(["board", "nid", "id", "no", "idx"]),
    kindOf: byPrefix("statement"),
  },
  {
    // 신문 기사와 성명이 한 피드에 섞여 있다. 명진 결정(11/01 22:30): 성명뿐 아니라 기사도 받는다.
    // 제목 머리말에 '성명'이 있으면([노동자연대 성명]·[성명]·[노동자연대 학생그룹 성명], 괄호 없는 '노동자연대 성명: …') 성명,
    // 나머지는 기사(article: 종류 칸 비움). 공지·안내·모집 등 머리말 글은 다른 단체처럼 뺀다(byPrefix).
    // 하루 수십 건이어도 한 번 실행에 단체마다 새 글 MAX_NEW_PER_RUN(8)건, 나머지는 다음 실행으로 넘긴다(handler.ts).
    key: "ws", name: "노동자연대", group: "movement", lang: "ko", mode: "rss",
    lists: ["https://ws.or.kr/feed"], hosts: ["ws.or.kr", "www.ws.or.kr"],
    canon: plain,
    kindOf: (title) => (WS_BARE_STATEMENT.test(title) ? "statement" : byPrefix("article")(title)),
  },
  {
    // 2026-11-01 확인: RSS·사이트맵이 없고, 글 목록(/readings)은 모든 글을 한 쪽에 실어 3.4MB라 2MB 상한에 걸렸다(too_large).
    // 상한은 그대로 두고 더 작은 첫 화면(약 0.8MB, 최근 글 30개 카드)을 목록으로 읽는다. 카드 제목은 `h2.PostCard-module__…__title`.
    key: "platformc", name: "플랫폼C", group: "movement", lang: "ko", mode: "html",
    lists: ["https://platformc.kr/"], hosts: ["platformc.kr", "www.platformc.kr"],
    item: /^https:\/\/(www\.)?platformc\.kr\/\d{4}\/\d{2}\/[^/?#]+\/?$/, canon: plain,
    titleClass: /(^|__)title$/,
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
    // 2026-11-01 확인('건너뜀 8'의 까닭): 글 쪽 첫 <article>은 공유 단추 칸이라 본문을 0자로 읽었다 → 본문 칸 `#body_content`만 읽는다.
    // 목록 쪽에는 메뉴(기본강령·대중투쟁강령)·옆 칸(다른 게시판 글) 링크도 같은 주소 모양이라, 성명/논평 게시판 링크(me_code=20)만 받는다.
    // 카드 제목 칸은 줄임표로 잘려 있어 그림 title(제목 전체)을 쓰고, 날짜는 카드의 `li.date`(글 쪽 머리의 '최종편집' 날짜가 아님).
    item: /^https:\/\/socialism\.jinbo\.net\/bbs\/board\.php\?(?=[^#]*\bbo_table=news\b)(?=[^#]*\bwr_id=\d+\b)(?=[^#]*\bme_code=20\b)/,
    canon: keepQuery(["bo_table", "wr_id"]),
    titleAttr: true,
    dateClass: /^date$/,
    bodyClass: /^body_content$/,
    // 옆 칸 '최신 기사'도 같은 게시판 주소(me_code=20)로 붙어 있어, 머리말([성명]·[논평]·[…입장…] 등)이 있는 글만 넣는다([번역]·[후기]·머리말 없는 기사는 뺌).
    kindOf: byPrefix(null),
  },
  {
    // 사이트(http://socialist.kr/feed)는 로봇 확인 화면(bot_check, 2026-11-01 운영 실행)이라 읽지 않는다 — 그 화면은 절대 우회하지 않는다.
    // 명진 결정 11/01 21:13: 이 단체의 공개 텔레그램 채널(@ksocialist) 웹 미리보기(로그인 없이 열리는 공개 페이지)를 읽기 경로로 쓴다.
    // t.me는 이 단체의 이 경로(목록 t.me/s/ksocialist, 글 t.me/ksocialist/<번호>)만 허용한다. robots.txt는 그대로 지킨다(예외 아님).
    // 글 쪽은 읽지 않는다: 본문은 채널 글 자체, 원문 링크는 본문 안 socialist.kr 글 주소(있으면, 요청하지 않고 링크로만) 아니면 채널 글 주소.
    key: "socialist", name: "사회주의자", group: "movement", lang: "ko", mode: "telegram", telegram: "ksocialist",
    lists: ["https://t.me/s/ksocialist"], hosts: ["t.me", "socialist.kr", "www.socialist.kr"], httpHosts: ["socialist.kr", "www.socialist.kr"],
    // WordPress 짧은 주소(?p=번호)는 번호를 남긴다(빼면 모든 글이 첫 화면 주소 하나로 겹친다).
    canon: (u) => { const p = u.searchParams.get("p"); return p && /^\d{1,9}$/.test(p) ? `${plain(u)}?p=${p}` : plain(u); },
    kindOf: byPrefix("article"),
  },
  // 외국 매체(Q5): 제목·링크·한국어 요약·핵심 문장 3개까지만 저장한다(본문·전문 번역 저장 안 함, 2절).
  {
    // 피드에 본문이 없고 소개 글만 있다. 글 쪽 본문은 `div.po-bo__content`(여러 칸으로 나뉨) — 첫 <article> 안에 다른 글 카드가 겹쳐 있어 그 칸만 읽는다(2026-11-01 확인).
    key: "jacobin", name: "Jacobin", group: "foreign", lang: "en", mode: "rss",
    lists: ["https://jacobin.com/rss"], hosts: ["jacobin.com", "www.jacobin.com"], canon: plain, kindOf: () => "article",
    bodyClass: /^po-bo__content$/,
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
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (source.httpHosts ?? []).includes(host))) return null;
  if (u.username || u.password || u.port) return null;
  if (!source.hosts.includes(host)) return null;
  // t.me는 단체 채널 경로만(다른 채널·로그인·앱 주소 금지): /s/<채널> 목록, /<채널>/<번호> 글.
  if (host === "t.me") {
    const ch = source.telegram;
    if (!ch) return null;
    const p = u.pathname;
    if (!(p === `/s/${ch}` || new RegExp(`^/${ch}/\\d{1,9}$`).test(p))) return null;
  }
  return u;
}

// 화면에 돌려주는 모양(주소·규칙은 싣지 않음).
export function publicCatalog() {
  return OUTSIDE_CATALOG.map(({ key, name, group, lang }) => ({ key, name, group, lang }));
}
