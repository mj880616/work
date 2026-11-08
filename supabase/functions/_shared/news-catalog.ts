// 뉴스 클리핑 카탈로그(NEWS-클리핑 B, 설계 docs/design/news-clipping.md 3절 + S47-44 결정).
// 서버(news-feed)가 '자동'으로 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고 매체 키만 고른다(SSRF 차단).
// 모양은 바깥 성명 카탈로그(OutsideSource)와 같아서 RSS 해석·주소 검사(parseFeed·allowedUrl)를 그대로 함께 쓴다.
// 키는 app_outside_sources에 'news-' 앞머리로 들어간다(사회운동 Now 단체 키와 섞이지 않음).
// 넣은 것: 설계 3절에서 RSS 주소가 [사실]로 확인된 곳만. 나머지([추정]·RSS 없음)는 넣지 않고 키워드(구글 뉴스 RSS)로만 잡는다(N8).
//   robots.txt는 수집기가 실행 때마다 직접 읽고 막혀 있으면 건너뛴다(우회 없음).
// 뺀 것(결정): 네이버 검색 API(약관상 AI 요약·자동 수집 금지 — 쓰지 않음), Equal Times(발행 중단), AP·Reuters·NHK·共同通信(노동 분야 공개 피드 확인 못 함 → 키워드로만, N10),
//   정책브리핑(RSS 중단 — 공식 API 서비스 키가 생기면 별도 PR, N9).
// 새 매체는 여기 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).
import type { OutsideSource } from "./outside-catalog.ts";

// take: 'all'(그 매체 글을 키워드 상관없이 전부 받음 — 운동·노동 매체) / 'keywords'(키워드 목록에 글자가 맞는 글만 — 종합지·방송사, NEWS-매체늘리기).
// 없으면 'all'. 운동·노동·해외 노조 매체는 'all', 종합지·방송사·통신사는 'keywords'(S53-6).
// on: true = 기본 켬(S53-6, 설계 3.1c). 그 작업공간에 이 매체 줄(app_outside_sources)이 아직 없으면 켠 것으로 본다 — 끄면 enabled=false 줄이 남아 그대로 꺼진다.
//   기본 켬은 뉴스를 쓰는 작업공간(키워드가 있거나 news- 매체 줄이 하나라도 있는 곳)에만 적용하고, 처음 읽을 때 서버가 켬 줄을 만들어 읽은 시각·실패를 남긴다.
// 채널 기사(열린 주소 규칙, 매체가 정해져 있지 않음) 본문 규칙. 규칙 이름 `open@판`.
// @2(S51-9): 흔한 유료벽 검사를 좁힘(문구는 본문 칸 안만, class는 정확히 `paywall`) + 본문 칸 고르기(빈 <article> 건너뛰기·폼 안 본문).
export const OPEN_ARTICLE_RULE = Object.freeze({ version: 2 });
export const OPEN_ARTICLE_KEY = "open";
export type NewsSource = OutsideSource & { region: "domestic" | "foreign"; paid?: boolean; take?: "all" | "keywords"; on?: true };

const article = () => "article" as const;

export const NEWS_CATALOG: readonly NewsSource[] = Object.freeze([
  { key: "news-labortoday", name: "매일노동뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    // 본문 칸: 엔디소프트 기사 쪽 `#article-view-content-div`(못 찾으면 흔한 본문 칸·<article> 순서). 유료 기사는 page.ts가 앞부분만(유료벽 넘지 않음).
    // @2(S51-9): 흔한 유료벽 검사를 좁힘(page.ts) — 이 매체는 유료벽 검사를 그대로 받는다(유료 기사 있음 [추정]).
    // @3(S51-15): 공용 추출기 고침(닫는 꼬리표가 없는 빼는 칸이 뒤 본문을 모두 지우던 것, 본문 앞 공유 줄) — lead/no_body 3건을 다시 뽑기(P2c)로 다시 본다.
    extract: { version: 3, drop: /^(article-copy|view-copyright|view-editors|tag-group|article-sns|share-btns|relation|ad-template)$/ },
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.labortoday.co.kr/rss/allArticle.xml"], hosts: ["www.labortoday.co.kr", "labortoday.co.kr"], kindOf: article },
  { key: "news-beminor", name: "비마이너", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    // @2(S51-9): 11/06 probe에서 lead/paywall(블록 1·글자 300)로 잘못 들어감 — 비마이너는 유료벽이 없다(CC 확인) → free(흔한 유료벽 검사 안 함).
    extract: { version: 2, free: true, drop: /^(article-copy|view-copyright|view-editors|tag-group|article-sns|share-btns|relation|ad-template)$/ },
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.beminor.com/rss/allArticle.xml"], hosts: ["www.beminor.com", "beminor.com"], kindOf: article },
  { key: "news-pressian", name: "프레시안", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    // @2(S51-9): 11/06 probe에서 lead/paywall(블록 1·글자 14)로 잘못 들어감 — 프레시안은 유료벽이 없다(CC 확인) → free.
    // 본문 칸 `div.article_body`를 단체 본문 칸으로 고정 [추정 — 실측 못 함, 없으면 예전처럼 <article>·흔한 본문 칸 순서].
    // @3(S51-15): @2 배포 뒤 30건이 모두 lead/no_body(사이트는 열림) — 본문 칸 `article_body`에서 본문을 못 뽑음 [사실: CC 운영 확인 / 까닭은 추정].
    //   실제 글 쪽 화면 줄 차례(WebFetch로 확인 [사실], HTML class는 못 봄): 제목 → 공유 아이콘 → 제목 → 부제 → 기자·기사입력 → 공유(페이스북·트위터·밴드)
    //   → 'URL복사' → 본문 문단·사진·캡션(…ⓒ매체) → '구글에서 프레시안을 더 자주 만나기' → 기자 이름·메일 → '최근글보기' → 제보·후원 → 댓글 → 관련기사.
    //   그래서 본문 칸에서 못 뽑으면 페이지 전체에서 'URL복사' 줄 다음부터 '구글에서 프레시안…'·'프레시안에 제보하기'·'최근글보기' 줄 앞까지 뽑는다(start·end).
    //   공용 추출기 고침(닫는 꼬리표 없는 빼는 칸이 뒤를 지우던 것)도 이 판에 든다. probe의 scope(own·page_rule)·cut 코드로 어느 길이었는지 확인한다.
    extract: { version: 3, free: true, drop: /^(article_ad|box_ad|article_bottom|byline|share)$/,
      start: /^URL\s*복사$/, end: /^(구글에서 프레시안을 더 자주 만나기|프레시안에 제보하기|최근글보기)$/ },
    bodyClass: /^article_body$/,
    // https://www.pressian.com/rss 는 RSS 안내 HTML 쪽이라 0건이었다(11/04). 실제 피드는 /api/v3/site/rss/news(요청함은 http로 확인).
    // 카탈로그는 https만 허용(tests/security/news-feed.test.mjs)이라 https로 둔다 — 배포 전 CC가 이 주소가 열리는지 확인하고, 안 열리면 배포하지 말고 명진에게 보고(http 허용은 보안 시험을 바꾸는 결정).
    lists: ["https://www.pressian.com/api/v3/site/rss/news"], hosts: ["www.pressian.com", "pressian.com"], kindOf: article },
  // ---- 종합지·통신사·방송사(S53-6, NEWS-매체늘리기). 설계 3.1b: 매체 공식 'RSS 안내' 쪽에 [사실]로 나온 피드 주소만 넣었다(안내 쪽 주소·날짜는 설계 12절).
  //   take: 'keywords' — 사회·경제·정치 섹션 피드에서 내 키워드가 제목·소개에 글자 그대로 든 글만 받는다(AI 없이).
  //   extract: false — 글 쪽(본문)은 수집 때 읽지 않는다(피드의 제목·소개·주소만, 설계 5절 ③ 매체 경계). 사람이 [본문]을 누를 때 열기는 다른 매체와 같다. 안내 쪽 이용 조건이 '개인 구독'이라 공개로 다시 내보내는 길은 없다.
  //   robots.txt는 수집기가 실행 때마다 읽고 막혀 있으면 건너뛴다. 피드가 실제로 열리는지는 이 세션 도구로 열지 못해 배포 뒤 probe로 확인한다(PR 본문).
  { key: "news-khan", name: "경향신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "keywords", on: true,
    // 안내 쪽 khan.co.kr/help/help_rss.html [사실]. 같은 경로의 영문 피드는 RSS 2.0·dc:date·요약 description으로 열림 [사실, 11/08].
    extract: false,
    lists: ["https://www.khan.co.kr/rss/rssdata/society_news.xml", "https://www.khan.co.kr/rss/rssdata/economy_news.xml", "https://www.khan.co.kr/rss/rssdata/politic_news.xml"],
    hosts: ["www.khan.co.kr", "khan.co.kr"], kindOf: article },
  { key: "news-ohmynews", name: "오마이뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "keywords", on: true,
    // 안내 쪽 m.ohmynews.com/NWS_Web/Help/srv/h_help_rss.aspx [사실]: '개인적 이용에 한정, 재배포·재RSS 금지'.
    extract: false,
    lists: ["https://rss.ohmynews.com/rss/society.xml", "https://rss.ohmynews.com/rss/economy.xml", "https://rss.ohmynews.com/rss/politics.xml"],
    hosts: ["rss.ohmynews.com", "www.ohmynews.com", "m.ohmynews.com", "ohmynews.com"], kindOf: article },
  { key: "news-hankyung", name: "한국경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "keywords", on: true,
    // 안내 쪽 hankyung.com/feed [사실]. 경영계 시각 균형용(설계 3.1b).
    extract: false,
    lists: ["https://www.hankyung.com/feed/society", "https://www.hankyung.com/feed/economy", "https://www.hankyung.com/feed/politics"],
    hosts: ["www.hankyung.com", "hankyung.com"], kindOf: article },
  { key: "news-psi", name: "PSI", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    extract: { version: 1 },
    lists: ["https://publicservices.international/feed.xml"], hosts: ["publicservices.international"], kindOf: article },
  { key: "news-itf", name: "ITF", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    extract: { version: 1 },
    lists: ["https://www.itfglobal.org/en/rss/feed"], hosts: ["www.itfglobal.org", "itfglobal.org"], kindOf: article },
  { key: "news-labourstart", name: "LabourStart(아시아)", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    // 링크가 남의 매체라 허용 호스트 밖 — 본문은 읽지 않고 failed/off_host(4.3절). 규칙은 판 번호만.
    // S51-9: 피드 글 링크가 모두 허용 호스트 밖이면 parseFeed가 다 빼서 기사 줄 자체가 0건이다(probe는 off_host로 보고). 기사 줄을 남기는 길은 범위 밖(보고만).
    extract: { version: 1 },
    lists: ["https://www.labourstart.org/rdf/labourstart.asia.rss"], hosts: ["www.labourstart.org", "labourstart.org"], kindOf: article },
] as NewsSource[]);

export const NEWS_SOURCE_KEYS: readonly string[] = Object.freeze(NEWS_CATALOG.map((s) => s.key));
export function newsSourceByKey(key: unknown): NewsSource | null {
  return typeof key === "string" ? NEWS_CATALOG.find((s) => s.key === key) ?? null : null;
}
export function publicNewsCatalog() {
  return NEWS_CATALOG.map((s) => ({ key: s.key, name: s.name, region: s.region, lang: s.lang, on: s.on === true }));
}

// 키워드 찾기: 구글 뉴스 검색 RSS 한 호스트·한 경로만. 검색어는 서버가 키워드로 만든다(화면은 주소를 보내지 않음).
// 링크는 구글 중계 주소 그대로 둔다(풀지 않음, N3). 누르면 브라우저가 원문으로 넘어간다.
export const GOOGLE_NEWS: OutsideSource = Object.freeze({
  key: "news-google", name: "구글 뉴스", group: "foreign", lang: "ko", mode: "rss",
  // 중계 주소는 읽지 않는다(N3) — 본문은 failed/relay.
  extract: false,
  lists: [], hosts: ["news.google.com"], kindOf: article,
}) as OutsideSource;
export function googleNewsUrl(word: string): string {
  const q = `"${word.replace(/"/g, " ").trim()}" when:1d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
}

// take=keywords 매체(종합지·방송사)의 글 거르기: 제목+소개에 키워드 낱말이 글자 그대로 들어 있으면 통과(AI 없이 글자 일치, 대소문자·앞뒤 공백 무시).
export function matchedKeywords(text: string, words: readonly string[]): string[] {
  const hay = text.toLowerCase();
  const out: string[] = [];
  for (const w of words) {
    const k = w.trim().toLowerCase();
    if (k && hay.includes(k) && !out.includes(w)) out.push(w);
  }
  return out;
}
