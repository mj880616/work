// 뉴스 클리핑 카탈로그(NEWS-클리핑 B, 설계 docs/design/news-clipping.md 3절 + S47-44 결정).
// 서버(news-feed)가 '자동'으로 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고 매체 키만 고른다(SSRF 차단).
// 모양은 바깥 성명 카탈로그(OutsideSource)와 같아서 RSS 해석·주소 검사(parseFeed·allowedUrl)를 그대로 함께 쓴다.
// 키는 app_outside_sources에 'news-' 앞머리로 들어간다(사회운동 Now 단체 키와 섞이지 않음).
// 넣은 것: 설계 3절에서 RSS 주소가 [사실]로 확인된 곳은 자기 RSS로. 나머지([추정]·RSS 없음·robots 막힘·https 아님·봇 확인)는
//   구글 뉴스 매체 단위 줄(google: 도메인, S57-13 — 설계 3.1g)로 받는다. 그 전에는 키워드(구글 뉴스 RSS)에 걸린 글만 들어왔다(N8).
//   robots.txt는 수집기가 실행 때마다 직접 읽고 막혀 있으면 건너뛴다(우회 없음).
// 뺀 것(결정): 네이버 검색 API(약관상 AI 요약·자동 수집 금지 — 쓰지 않음), Equal Times(발행 중단), AP·Reuters·NHK·共同通信(노동 분야 공개 피드 확인 못 함 → 키워드로만, N10),
//   정책브리핑(RSS 중단 — 공식 API 서비스 키가 생기면 별도 PR, N9).
// 새 매체는 여기 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).
import type { OutsideSource } from "./outside-catalog.ts";

// take: 'all'(그 매체 글을 키워드 상관없이 전부 받음) / 'keywords'(키워드 목록에 글자가 맞는 글만 — 종합지·방송사, NEWS-매체늘리기).
// 없으면 'all'. 11/09 14:22 명진 결정(NEWS-다받기): "구독한 언론사들은 최대한 들여오고" — 지금 카탈로그의 국내 매체는 모두 'all'이다.
//   'keywords' 길(matchedKeywords)은 지우지 않고 남긴다(받은 뒤 줄일 방안을 찾을 때 다시 쓸 수 있게, 명진 같은 말).
// on: true = 기본 켬(S53-6, 설계 3.1c). 그 작업공간에 이 매체 줄(app_outside_sources)이 아직 없으면 켠 것으로 본다 — 끄면 enabled=false 줄이 남아 그대로 꺼진다.
//   기본 켬은 뉴스를 쓰는 작업공간(키워드가 있거나 news- 매체 줄이 하나라도 있는 곳)에만 적용하고, 처음 읽을 때 서버가 켬 줄을 만들어 읽은 시각·실패를 남긴다.
// 채널 기사(열린 주소 규칙, 매체가 정해져 있지 않음) 본문 규칙. 규칙 이름 `open@판`.
// @2(S51-9): 흔한 유료벽 검사를 좁힘(문구는 본문 칸 안만, class는 정확히 `paywall`) + 본문 칸 고르기(빈 <article> 건너뛰기·폼 안 본문).
export const OPEN_ARTICLE_RULE = Object.freeze({ version: 2 });
export const OPEN_ARTICLE_KEY = "open";
// google: 구글 뉴스 매체 단위 줄(S57-13, NEWS-못넣은곳대안 ②)의 매체 도메인. 이 값이 있으면 그 매체는 자기 RSS 대신
//   구글 뉴스 검색 RSS를 `site:도메인`으로 읽는다(키워드와 상관없이 그 매체 글 전부). 읽는 주소는 news.google.com 검색 RSS 한 경로뿐이고,
//   글 링크는 구글 중계 주소 그대로다(풀지 않음, N3) — 본문은 읽지 않고 제목·매체·날짜·링크만 남긴다(11/11 명진: 제목만이라도).
// linkOut: 피드 글 링크가 남의 매체로 가는 피드(LabourStart). 글 줄은 남기되(제목·날짜·링크) 그 링크는 저장만 하고 읽지 않는다
//   — 링크는 열린 주소 규칙(https 공개 호스트, openArticleUrl)을 통과한 것만, 수집기가 읽는 주소는 여전히 hosts뿐이다(S57-13 전수).
export type NewsSource = OutsideSource & { region: "domestic" | "foreign"; paid?: boolean; take?: "all" | "keywords"; on?: true; google?: string; linkOut?: true };

const article = () => "article" as const;

// 구글 뉴스 검색 RSS(키워드 찾기·매체 단위 줄이 함께 쓰는 한 호스트·한 경로). 검색어는 서버가 만든다(화면은 주소를 보내지 않음).
export const GOOGLE_NEWS_HOST = "news.google.com";
const googleSearchUrl = (q: string) => `https://${GOOGLE_NEWS_HOST}/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
// 매체 단위: `site:도메인 when:1d`(하루치 — 수집은 하루 3번이라 겹쳐 읽고, 겹친 글은 주소·제목으로 거른다). 도메인은 카탈로그 글자만(영문 소문자·숫자·점·줄표).
export function googleSiteUrl(domain: string): string {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error("news-catalog: bad google site domain");
  return googleSearchUrl(`site:${domain} when:1d`);
}
// 매체 단위 구글 뉴스 줄 한 개. 규칙은 다른 국내 매체와 같다: take 'all'·기본 켬·extract:false. 매체 이름은 카탈로그 name으로 통일한다
//   (구글 제목 끝 ' - 매체'는 떼어 낸다 — 목록의 매체 이름·도배막기 묶음·색이 RSS 매체와 같은 길로 간다).
const viaGoogle = (key: string, name: string, domain: string): NewsSource => ({
  key, name, group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
  extract: false, google: domain, lists: [googleSiteUrl(domain)], hosts: [GOOGLE_NEWS_HOST], kindOf: article });
export const isGoogleSite = (s: { google?: string } | null | undefined): boolean => typeof s?.google === "string" && s.google.length > 0;

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
  //   take: 'all'(11/09 NEWS-다받기, 그 전엔 'keywords') — 사회·경제·정치 섹션 피드 글을 키워드 상관없이 모두 받는다. 수집 때 AI는 쓰지 않는다(국내 글이라 제목 번역도 없음).
  //   extract: false — 글 쪽(본문)은 수집 때 읽지 않는다(피드의 제목·소개·주소만, 설계 5절 ③ 매체 경계). 사람이 [본문]을 누를 때 열기는 다른 매체와 같다. 안내 쪽 이용 조건이 '개인 구독'이라 공개로 다시 내보내는 길은 없다.
  //   robots.txt는 수집기가 실행 때마다 읽고 막혀 있으면 건너뛴다. 피드가 실제로 열리는지는 이 세션 도구로 열지 못해 배포 뒤 probe로 확인한다(PR 본문).
  { key: "news-khan", name: "경향신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 khan.co.kr/help/help_rss.html [사실]. 같은 경로의 영문 피드는 RSS 2.0·dc:date·요약 description으로 열림 [사실, 11/08].
    extract: false,
    lists: ["https://www.khan.co.kr/rss/rssdata/society_news.xml", "https://www.khan.co.kr/rss/rssdata/economy_news.xml", "https://www.khan.co.kr/rss/rssdata/politic_news.xml"],
    hosts: ["www.khan.co.kr", "khan.co.kr"], kindOf: article },
  { key: "news-ohmynews", name: "오마이뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 m.ohmynews.com/NWS_Web/Help/srv/h_help_rss.aspx [사실]: '개인적 이용에 한정, 재배포·재RSS 금지'.
    extract: false,
    lists: ["https://rss.ohmynews.com/rss/society.xml", "https://rss.ohmynews.com/rss/economy.xml", "https://rss.ohmynews.com/rss/politics.xml"],
    hosts: ["rss.ohmynews.com", "www.ohmynews.com", "m.ohmynews.com", "ohmynews.com"], kindOf: article },
  { key: "news-hankyung", name: "한국경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 hankyung.com/feed [사실]. 경영계 시각 균형용(설계 3.1b).
    extract: false,
    lists: ["https://www.hankyung.com/feed/society", "https://www.hankyung.com/feed/economy", "https://www.hankyung.com/feed/politics"],
    hosts: ["www.hankyung.com", "hankyung.com"], kindOf: article },
  // ---- 2차(S54-02, 11/08 CC가 크롬으로 직접 열어 확인). 안내 쪽·피드에 AI 금지 문구가 없는 곳만 넣었다(설계 3.1b 2차 표).
  //   hosts의 기사 주소 호스트는 이 세션에서 피드를 열지 못해 [추정]이다 — 배포 뒤 probe에서 글이 0건이면 링크 호스트·https 여부부터 본다(PR 본문).
  { key: "news-mk", name: "매일경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 www.mk.co.kr/rss [사실, 11/08 CC 크롬 확인]: AI 금지 문구 없음. 사회 피드 열림(application/xml·item 50·description 있음, copyright 'Copyright 2026 MK').
    extract: false,
    lists: ["https://www.mk.co.kr/rss/50400012/", "https://www.mk.co.kr/rss/30100041/", "https://www.mk.co.kr/rss/30200030/"],
    hosts: ["www.mk.co.kr", "mk.co.kr"], kindOf: article },
  { key: "news-sisain", name: "시사IN", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 홈 머리 공식 RSS 링크(cdn.sisain.co.kr/rss/…) [사실, 11/08 CC 크롬 확인]: 전체 피드 열림(item 50·description 있음), AI 문구 없음.
    extract: false,
    lists: ["https://cdn.sisain.co.kr/rss/gns_allArticle.xml"],
    hosts: ["cdn.sisain.co.kr", "www.sisain.co.kr", "sisain.co.kr"], kindOf: article },
  { key: "news-newstapa", name: "뉴스타파", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 홈 공식 링크 /rss [사실, 11/08 CC 크롬 확인]: 피드 열림(text/xml·item 20·description 있음), AI 문구 없음.
    extract: false,
    lists: ["https://newstapa.org/rss"],
    hosts: ["newstapa.org", "www.newstapa.org"], kindOf: article },
  // ---- 3차(S54-03, 11/08 19:50 CC가 명진 크롬으로 피드를 직접 받아 확인: 모두 HTTP 200·item·description 있음 [사실]).
  //   'AI 학습·활용 금지' 문구가 있는 매체도 넣는다 — 11/08 19:46 명진 결정 "AI 문구 매체도 넣어, 어차피 개인 용도"(설계 3.1b 3차).
  //   take·extract: false(글 쪽은 수집 때 읽지 않음)는 1·2차와 같다. hosts에는 피드 호스트와 기사 호스트를 모두 넣는다.
  //   주소에 쿼리(?sectionId·?outputType)가 있어도 allowedUrl은 호스트·https·포트·계정만 보므로 그대로 통과한다(규칙을 넓히지 않음).
  { key: "news-hani", name: "한겨레", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 피드 www.hani.co.kr/rss/ [사실, 11/08 CC 크롬 확인: 섹션마다 item 30, 기사 링크 www.hani.co.kr]. AI 문구 있음(피드 copyright 'AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://www.hani.co.kr/rss/society/", "https://www.hani.co.kr/rss/economy/", "https://www.hani.co.kr/rss/politics/"],
    hosts: ["www.hani.co.kr", "hani.co.kr"], kindOf: article },
  { key: "news-yna", name: "연합뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 www.yna.co.kr/rss/index(비상업·개인) [사실, 11/08 CC 크롬 확인: 섹션마다 item 120]. 기사 호스트 www.yna.co.kr는 [추정] — 이 세션은 피드를 열지 못함, 배포 뒤 probe로 확인.
    // AI 문구 있음(피드 copyright 'AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://www.yna.co.kr/rss/society.xml", "https://www.yna.co.kr/rss/economy.xml", "https://www.yna.co.kr/rss/politics.xml"],
    hosts: ["www.yna.co.kr", "yna.co.kr", "m.yna.co.kr"], kindOf: article },
  { key: "news-donga", name: "동아일보", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 rss.donga.com(개인 비상업) [사실, 11/08 CC 크롬 확인: 섹션마다 item 50, 기사 링크 www.donga.com]. AI 문구 있음(하단 'AI학습 이용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://rss.donga.com/national.xml", "https://rss.donga.com/economy.xml", "https://rss.donga.com/politics.xml"],
    hosts: ["rss.donga.com", "www.donga.com", "donga.com"], kindOf: article },
  { key: "news-jtbc", name: "JTBC", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 news.jtbc.co.kr/rss [사실, 11/08 CC 크롬 확인: item 사회 11·경제 4·정치 14, 기사 링크 news.jtbc.co.kr]. AI 문구 있음(하단 'AI 학습 등 금함'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://news-ex.jtbc.co.kr/v1/get/rss/section/society", "https://news-ex.jtbc.co.kr/v1/get/rss/section/economy", "https://news-ex.jtbc.co.kr/v1/get/rss/section/politics"],
    hosts: ["news-ex.jtbc.co.kr", "news.jtbc.co.kr"], kindOf: article },
  { key: "news-sbs", name: "SBS", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 news.sbs.co.kr/news/rss.do [사실, 11/08 CC 크롬 확인: 섹션마다 item 29]. 기사 호스트 news.sbs.co.kr는 [추정] — 배포 뒤 probe로 확인.
    // AI 문구 있음('AI학습 이용 금지'), 명진 결정으로 넣음(개인 용도). sectionId 03 사회·02 경제·01 정치.
    extract: false,
    lists: ["https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER", "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER", "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER"],
    hosts: ["news.sbs.co.kr", "mnews.sbs.co.kr"], kindOf: article },
  { key: "news-nocut", name: "노컷뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 nocutnews.co.kr/rss/ [사실, 11/08 CC 크롬 확인: 섹션마다 item 50, 기사 링크 www.nocutnews.co.kr]. AI 문구 있음('AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://rss.nocutnews.co.kr/category/society.xml", "https://rss.nocutnews.co.kr/category/economy.xml", "https://rss.nocutnews.co.kr/category/politics.xml"],
    hosts: ["rss.nocutnews.co.kr", "www.nocutnews.co.kr", "nocutnews.co.kr"], kindOf: article },
  { key: "news-chosun", name: "조선일보", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 공식 안내 쪽 없음 — 사이트 자체 주소(arc outboundfeeds) [사실, 11/08 CC 크롬 확인: 섹션마다 item 100, 기사 링크 www.chosun.com]. AI 문구 없음. 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://www.chosun.com/arc/outboundfeeds/rss/category/national/?outputType=xml", "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", "https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml"],
    hosts: ["www.chosun.com", "chosun.com"], kindOf: article },
  // ---- 4차(S56-54, 11/10 NEWS-다받기-새언론사). 같은 규칙: 매체 공식 'RSS 안내' 쪽에 [사실]로 나온 피드 주소만, take 'all'·기본 켬·extract:false.
  //   이 웹 세션은 WebSearch 결과로 나온 안내 쪽을 WebFetch로 열어 확인했다(설계 3.1f 표). 피드 실물은 뉴시스·서울경제 사회 피드만 열림 [사실],
  //   매일신문은 안내 쪽만 [사실]이고 피드·기사 호스트는 배포 뒤 probe(raw·listed)로 CC가 확인했다(11/11 운영: 뉴시스 271·서울경제 146·매일신문 254건 [사실]).
  //   미디어오늘은 같이 넣었으나 그쪽 robots.txt가 수집기를 막아(수집 결과 'robots', 0건 [사실: 11/11 CC 운영 확인]) RSS 줄을 빼고 아래 5차 구글 뉴스 매체 단위 줄로 옮겼다.
  //   'AI 학습 금지' 문구가 있는 서울경제도 넣는다 — 11/08 명진 결정(개인 용도)과 같은 기준.
  // 미디어오늘(S57-13): 자기 RSS는 그쪽 robots.txt가 막아 구글 뉴스 매체 단위 줄로 옮김(아래 5차). 키와 자리(순서)는 그대로 둔다 — 켬·끔 설정과 다른 매체의 색 칸이 바뀌지 않게.
  viaGoogle("news-mediatoday", "미디어오늘", "mediatoday.co.kr"),
  { key: "news-newsis", name: "뉴시스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 www.newsis.com/RSS/ [사실, 11/10]. 사회 피드 열림(RSS 2.0·description 있음·기사 링크 https://www.newsis.com/view/…) [사실].
    // 조건: 하단 '무단 전재·복사·배포 금지', 피드 안 저작권 고지 줄 [사실]. 전체 피드는 없고 속보(sokbo)는 양이 많아 사회·경제·정치만.
    extract: false,
    lists: ["https://www.newsis.com/RSS/society.xml", "https://www.newsis.com/RSS/economy.xml", "https://www.newsis.com/RSS/politics.xml"],
    hosts: ["www.newsis.com", "newsis.com"], kindOf: article },
  { key: "news-sedaily", name: "서울경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 안내 쪽 www.sedaily.com/rss [사실, 11/10]: '개인 이용자의 비상업적 사용에만 허용', AI 학습 금지 [사실] → 명진 결정(11/08, 개인 용도)으로 넣음.
    // 사회 피드 열림(RSS 2.0·item 50·description 없음·기사 링크 https://www.sedaily.com/article/…) [사실].
    extract: false,
    lists: ["https://www.sedaily.com/rss/society", "https://www.sedaily.com/rss/economy", "https://www.sedaily.com/rss/politics"],
    hosts: ["www.sedaily.com", "sedaily.com"], kindOf: article },
  { key: "news-imaeil", name: "매일신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    // 대구 지역지. 안내 쪽 www.imaeil.com/rss_service [사실, 11/10]: 이용 조건 문구 없음(저작권 표기만) [사실]. 피드는 ?cate= 쿼리(allowedUrl은 호스트만 봄).
    // 기사 호스트 www.imaeil.com(/page/view/…)은 검색 결과로 본 주소 [사실], 피드 안 링크는 배포 뒤 probe로 확인.
    extract: false,
    lists: ["https://www.imaeil.com/rss?cate=society", "https://www.imaeil.com/rss?cate=economy", "https://www.imaeil.com/rss?cate=politics"],
    hosts: ["www.imaeil.com", "imaeil.com"], kindOf: article },
  { key: "news-psi", name: "PSI", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    extract: { version: 1 },
    lists: ["https://publicservices.international/feed.xml"], hosts: ["publicservices.international"], kindOf: article },
  { key: "news-itf", name: "ITF", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    extract: { version: 1 },
    lists: ["https://www.itfglobal.org/en/rss/feed"], hosts: ["www.itfglobal.org", "itfglobal.org"], kindOf: article },
  { key: "news-labourstart", name: "LabourStart(아시아)", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    // 링크가 남의 매체라 허용 호스트 밖 — 본문은 읽지 않고 failed/off_host(4.3절). 규칙은 판 번호만.
    // S51-9: 피드 글 링크가 모두 허용 호스트 밖이면 parseFeed가 다 빼서 기사 줄 자체가 0건이었다(probe는 off_host로 보고).
    // S57-13(11/11 명진 '제목만이라도'): linkOut — 기사 줄은 남긴다(제목·날짜·링크). 남의 매체 글 쪽은 지금처럼 읽지 않는다.
    linkOut: true,
    extract: { version: 1 },
    lists: ["https://www.labourstart.org/rdf/labourstart.asia.rss"], hosts: ["www.labourstart.org", "labourstart.org"], kindOf: article },
  // ---- 5차(S57-13, 11/11 NEWS-못넣은곳대안 ②): 자기 RSS로 못 넣는 곳은 구글 뉴스 매체 단위(site:도메인)로 받는다.
  //   지금 키워드 찾기(news-google)와 같은 길(검색 RSS 한 경로, robots.txt 먼저) — 새 서버 부품 없음. 키워드와 상관없이 그 매체 글 전부.
  //   한계: 구글 뉴스가 색인한 글만, 늦을 수 있음, 한 번에 많아야 100건, 링크가 구글 경유(본문은 읽지 않음 — 제목·매체·날짜·[원문]만).
  //   같은 글이 키워드 찾기로 먼저 들어와 있으면 주소·제목 겹침 거르기(insertNew)로 한 줄만 남는다.
  //   자리: 카탈로그 맨 끝에 더한다 — 앞선 매체의 순서(목록 색 칸이 카탈로그 순서로 정해짐, app/news-colors.mjs)가 바뀌지 않게. 매체 고르기 화면은 region으로 묶는다.
  //   까닭(설계 3.1f): 미디어오늘 = robots.txt가 막음, 노동과세계 = https가 아님(http로 넘김), 뉴스민 = 봇 확인, 철도경제신문·부산일보 = 공식 RSS 없음.
  viaGoogle("news-worknworld", "노동과세계", "worknworld.kctu.org"),
  viaGoogle("news-newsmin", "뉴스민", "newsmin.co.kr"),
  viaGoogle("news-redaily", "철도경제신문", "redaily.co.kr"),
  viaGoogle("news-busan", "부산일보", "busan.com"),
  //   ① 다시 확인(11/11, 이 세션 WebFetch)에서도 RSS로 못 넣은 9곳 — 공식 RSS 링크가 없거나(뉴스1·머니투데이·국제신문·경기일보·경인일보·영남일보·레디앙 [사실]),
  //   있어도 이 세션에서 안내 쪽·피드·robots.txt를 열지 못함(참여와혁신 rssIndex.html, 이데일리 하단 RSS 링크는 http 주소 [사실]).
  //   CC가 크롬으로 피드·robots를 확인하면 그 매체만 자기 RSS 줄로 바꾸는 작은 PR(키는 그대로 두면 켬·끔 설정이 유지된다).
  viaGoogle("news-laborplus", "참여와혁신", "laborplus.co.kr"),
  viaGoogle("news-redian", "레디앙", "redian.org"),
  viaGoogle("news-news1", "뉴스1", "news1.kr"),
  viaGoogle("news-edaily", "이데일리", "edaily.co.kr"),
  viaGoogle("news-mt", "머니투데이", "mt.co.kr"),
  viaGoogle("news-kookje", "국제신문", "kookje.co.kr"),
  viaGoogle("news-kyeonggi", "경기일보", "kyeonggi.com"),
  viaGoogle("news-kyeongin", "경인일보", "kyeongin.com"),
  viaGoogle("news-yeongnam", "영남일보", "yeongnam.com"),
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
  lists: [], hosts: [GOOGLE_NEWS_HOST], kindOf: article,
}) as OutsideSource;
export function googleNewsUrl(word: string): string {
  return googleSearchUrl(`"${word.replace(/"/g, " ").trim()}" when:1d`);
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
