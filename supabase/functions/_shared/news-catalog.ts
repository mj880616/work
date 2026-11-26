// 뉴스 클리핑 카탈로그(NEWS-클리핑 B, 설계 docs/design/news-clipping.md 3절 + S47-44 결정).
// 서버(news-feed)가 '자동'으로 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고 매체 키만 고른다(SSRF 차단).
// 모양은 바깥 성명 카탈로그(OutsideSource)와 같아서 RSS 해석·주소 검사(parseFeed·allowedUrl)를 그대로 함께 쓴다.
// 키는 app_outside_sources에 'news-' 앞머리로 들어간다(사회운동 Now 단체 키와 섞이지 않음).
// 넣은 것: 설계 3절에서 RSS 주소가 [사실]로 확인된 곳만 자기 RSS로 받는다. robots.txt는 수집기가 실행 때마다 직접 읽고 막혀 있으면 건너뛴다(우회 없음).
// 뺀 것(결정): 네이버 검색 API(약관상 AI 요약·자동 수집 금지 — 쓰지 않음), Equal Times(발행 중단), AP·Reuters·NHK·共同通信(노동 분야 공개 피드 확인 못 함, N10),
//   정책브리핑(RSS 중단 — 공식 API 서비스 키가 생기면 별도 PR, N9).
//   구글 뉴스 검색 RSS(키워드 찾기·매체 단위 site: 줄, S57-13): 구글 뉴스 robots.txt가 검색 RSS(/rss/search)를 금지한다(S58-9 #2393, docs/design/news-google-site-robots.md).
//   11/11 명진 결정(S59-1): 그 길은 버린다 — 길이 있는 매체는 자기 RSS로 옮기고(5차), 길이 없는 8곳은 카탈로그에서 뺐다(이데일리·미디어오늘·경기일보·경인일보·뉴스1·
//   부산일보·국제신문·영남일보). 그 매체의 이미 받은 글·켬 설정 줄(app_outside_sources)은 지우지 않는다 — 카탈로그 밖 키는 수집기·화면이 건너뛴다.
//   키워드는 밖에서 새로 찾지 않고 이미 받은 글에서 글자를 맞춘다(news-feed runKeywords, matchedKeywords).
// 새 매체는 여기 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).
// S71-70(사용자 2026-11-26 "한겨레도 같이좀 수집해봐 … 프레시안 이런데들도" / "지금 니가 언급한 곳들 다 가져와"): 매일노동뉴스·프레시안을 기본 켬으로,
//   참세상(자기 피드)·미디어오늘(피드는 robots 금지 그대로 — 허용된 분야 목록 쪽, mode "html")을 더했다. 한겨레는 이미 기본 켬(사회·경제·정치 + 사설·칼럼).
//   확인은 원문 점검(article-extract-live-check, GitHub 러너, 운영과 같은 robots 판정)의 '새 수집처 후보' 줄 [사실, 11/26].
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
// linkOut: 피드 글 링크가 남의 매체로 가는 피드(LabourStart). 글 줄은 남기되(제목·날짜·링크) 그 링크는 저장만 하고 읽지 않는다
//   — 링크는 열린 주소 규칙(https 공개 호스트, openArticleUrl)을 통과한 것만, 수집기가 읽는 주소는 여전히 hosts뿐이다(S57-13 전수).
// httpsLinks: 피드는 https로 열리는데 글 링크만 http로 적는 매체(노동과세계, S59-1). 그 매체 hosts의 글 링크만 https로 바꿔 받는다.
//   수집기는 http 주소를 요청하지 않는다(https 원칙 그대로) — 바꾼 주소도 주소 검사(allowedUrl)를 그대로 받고, 사이트가 http로 넘기면 따라가지 않는다.
// beat: "labor" = 노동 전문지·해외 노동 매체 — 거르지 않고 전부 받는다(등급 1, S63-10 news-rank.ts).
// sections: lists와 같은 차례로 그 피드의 섹션(society·politics·economy·mixed). 없으면 섞인 피드. mixedAs: 섞인 피드에서 섹션을 못 알아볼 때 볼 섹션(없으면 society).
//   종합지·방송사·통신사의 거르기·등급 규칙은 news-rank.ts 한 곳(S63-10 NEWS-언론거르기, 11/16 명진 결정).
// region "opinion"(S69 NEWS-사설칼럼, 명진 11/24 "주요 신문 사설 칼럼도 추가해줘요"): 신문의 사설·칼럼(오피니언) 피드. 화면 매체 고르기에서 '사설·칼럼' 묶음 하나로 모인다.
//   켬·끔은 다른 매체처럼 사람마다(app_outside_sources), 기본 켬(on). 새 저장 구조 없음.
export type NewsSource = OutsideSource & { region: "domestic" | "foreign" | "opinion"; paid?: boolean; take?: "all" | "keywords"; on?: true; linkOut?: true; httpsLinks?: true;
  beat?: "labor"; sections?: readonly ("society" | "politics" | "economy" | "mixed" | "opinion")[]; mixedAs?: "society" | "politics" | "economy";
  // S70-17b NEWS-제목꼭얻기: 같은 기사 알아보기(공유·모바일·amp 주소처럼 모양이 달라도 기사 번호가 같으면 같은 기사). _shared/same-article.ts가 쓴다.
  // site = 그 매체 주소의 도메인(그 도메인과 하위 도메인만 본다), ref = 주소 → 기사 번호(모르면 null).
  sameArticle?: { site: string; ref: (u: URL) => string | null } };

const article = () => "article" as const;

export const NEWS_CATALOG: readonly NewsSource[] = Object.freeze([
  { key: "news-labortoday", name: "매일노동뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // 본문 칸: 엔디소프트 기사 쪽 `#article-view-content-div`(못 찾으면 흔한 본문 칸·<article> 순서). 유료 기사는 page.ts가 앞부분만(유료벽 넘지 않음).
    // @2(S51-9): 흔한 유료벽 검사를 좁힘(page.ts) — 이 매체는 유료벽 검사를 그대로 받는다(유료 기사 있음 [추정]).
    // @3(S51-15): 공용 추출기 고침(닫는 꼬리표가 없는 빼는 칸이 뒤 본문을 모두 지우던 것, 본문 앞 공유 줄) — lead/no_body 3건을 다시 뽑기(P2c)로 다시 본다.
    extract: { version: 3, drop: /^(article-copy|view-copyright|view-editors|tag-group|article-sns|share-btns|relation|ad-template)$/ },
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.labortoday.co.kr/rss/allArticle.xml"], hosts: ["www.labortoday.co.kr", "labortoday.co.kr"], kindOf: article },
  { key: "news-beminor", name: "비마이너", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all",
    // @2(S51-9): 11/06 probe에서 lead/paywall(블록 1·글자 300)로 잘못 들어감 — 비마이너는 유료벽이 없다(CC 확인) → free(흔한 유료벽 검사 안 함).
    extract: { version: 2, free: true, drop: /^(article-copy|view-copyright|view-editors|tag-group|article-sns|share-btns|relation|ad-template)$/ },
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.beminor.com/rss/allArticle.xml"], hosts: ["www.beminor.com", "beminor.com"], kindOf: article },
  { key: "news-pressian", name: "프레시안", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", mixedAs: "society", on: true,
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
  { key: "news-khan", name: "경향신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 khan.co.kr/help/help_rss.html [사실]. 같은 경로의 영문 피드는 RSS 2.0·dc:date·요약 description으로 열림 [사실, 11/08].
    extract: false,
    lists: ["https://www.khan.co.kr/rss/rssdata/society_news.xml", "https://www.khan.co.kr/rss/rssdata/economy_news.xml", "https://www.khan.co.kr/rss/rssdata/politic_news.xml"],
    hosts: ["www.khan.co.kr", "khan.co.kr"], kindOf: article },
  { key: "news-ohmynews", name: "오마이뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 m.ohmynews.com/NWS_Web/Help/srv/h_help_rss.aspx [사실]: '개인적 이용에 한정, 재배포·재RSS 금지'.
    extract: false,
    lists: ["https://rss.ohmynews.com/rss/society.xml", "https://rss.ohmynews.com/rss/economy.xml", "https://rss.ohmynews.com/rss/politics.xml"],
    hosts: ["rss.ohmynews.com", "www.ohmynews.com", "m.ohmynews.com", "ohmynews.com"], kindOf: article },
  { key: "news-hankyung", name: "한국경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 hankyung.com/feed [사실]. 경영계 시각 균형용(설계 3.1b).
    extract: false,
    lists: ["https://www.hankyung.com/feed/society", "https://www.hankyung.com/feed/economy", "https://www.hankyung.com/feed/politics"],
    hosts: ["www.hankyung.com", "hankyung.com"], kindOf: article },
  // ---- 2차(S54-02, 11/08 CC가 크롬으로 직접 열어 확인). 안내 쪽·피드에 AI 금지 문구가 없는 곳만 넣었다(설계 3.1b 2차 표).
  //   hosts의 기사 주소 호스트는 이 세션에서 피드를 열지 못해 [추정]이다 — 배포 뒤 probe에서 글이 0건이면 링크 호스트·https 여부부터 본다(PR 본문).
  { key: "news-mk", name: "매일경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 www.mk.co.kr/rss [사실, 11/08 CC 크롬 확인]: AI 금지 문구 없음. 사회 피드 열림(application/xml·item 50·description 있음, copyright 'Copyright 2026 MK').
    extract: false,
    lists: ["https://www.mk.co.kr/rss/50400012/", "https://www.mk.co.kr/rss/30100041/", "https://www.mk.co.kr/rss/30200030/"],
    hosts: ["www.mk.co.kr", "mk.co.kr"], kindOf: article },
  { key: "news-sisain", name: "시사IN", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", mixedAs: "society", on: true,
    // 홈 머리 공식 RSS 링크(cdn.sisain.co.kr/rss/…) [사실, 11/08 CC 크롬 확인]: 전체 피드 열림(item 50·description 있음), AI 문구 없음.
    extract: false,
    // S69-06(실측 GitHub 러너): 엔디소프트 기사 쪽. 본문 칸 `#article-view-content-div`를 고정하지 않으면 앞의 짧은 <article>(머리)에서 멈춰 앞부분만 남았다.
    bodyClass: /^article-view-content-div$/,
    lists: ["https://cdn.sisain.co.kr/rss/gns_allArticle.xml"],
    hosts: ["cdn.sisain.co.kr", "www.sisain.co.kr", "sisain.co.kr"], kindOf: article },
  { key: "news-newstapa", name: "뉴스타파", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", mixedAs: "society", on: true,
    // 홈 공식 링크 /rss [사실, 11/08 CC 크롬 확인]: 피드 열림(text/xml·item 20·description 있음), AI 문구 없음.
    extract: false,
    lists: ["https://newstapa.org/rss"],
    hosts: ["newstapa.org", "www.newstapa.org"], kindOf: article },
  // ---- 3차(S54-03, 11/08 19:50 CC가 명진 크롬으로 피드를 직접 받아 확인: 모두 HTTP 200·item·description 있음 [사실]).
  //   'AI 학습·활용 금지' 문구가 있는 매체도 넣는다 — 11/08 19:46 명진 결정 "AI 문구 매체도 넣어, 어차피 개인 용도"(설계 3.1b 3차).
  //   take·extract: false(글 쪽은 수집 때 읽지 않음)는 1·2차와 같다. hosts에는 피드 호스트와 기사 호스트를 모두 넣는다.
  //   주소에 쿼리(?sectionId·?outputType)가 있어도 allowedUrl은 호스트·https·포트·계정만 보므로 그대로 통과한다(규칙을 넓히지 않음).
  { key: "news-hani", name: "한겨레", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 피드 www.hani.co.kr/rss/ [사실, 11/08 CC 크롬 확인: 섹션마다 item 30, 기사 링크 www.hani.co.kr]. AI 문구 있음(피드 copyright 'AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://www.hani.co.kr/rss/society/", "https://www.hani.co.kr/rss/economy/", "https://www.hani.co.kr/rss/politics/"],
    hosts: ["www.hani.co.kr", "hani.co.kr"], kindOf: article },
  { key: "news-yna", name: "연합뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 www.yna.co.kr/rss/index(비상업·개인) [사실, 11/08 CC 크롬 확인: 섹션마다 item 120]. 기사 호스트 www.yna.co.kr는 [추정] — 이 세션은 피드를 열지 못함, 배포 뒤 probe로 확인.
    // AI 문구 있음(피드 copyright 'AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    // S69-06(실측): 기사 본문 칸 `div.story-news`(앞의 <article>은 머리·사진 칸이라 앞부분만 남았다).
    bodyClass: /^story-news$/,
    lists: ["https://www.yna.co.kr/rss/society.xml", "https://www.yna.co.kr/rss/economy.xml", "https://www.yna.co.kr/rss/politics.xml"],
    hosts: ["www.yna.co.kr", "yna.co.kr", "m.yna.co.kr"], kindOf: article },
  { key: "news-donga", name: "동아일보", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 rss.donga.com(개인 비상업) [사실, 11/08 CC 크롬 확인: 섹션마다 item 50, 기사 링크 www.donga.com]. AI 문구 있음(하단 'AI학습 이용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://rss.donga.com/national.xml", "https://rss.donga.com/economy.xml", "https://rss.donga.com/politics.xml"],
    hosts: ["rss.donga.com", "www.donga.com", "donga.com"], kindOf: article,
    // 기사 주소 꼴: /news/<분류>/article/all/<날짜 8자리>/<기사 번호>/<쪽>, 분류 없는 공유 주소 /news/article/all/…, amp /news/amp/all/…, 모바일 m.donga.com 같은 꼴.
    sameArticle: { site: "donga.com", ref: (u) => /\/(?:article|amp)\/all\/\d{8}\/(\d{5,12})(?:\/\d{1,3})?\/?$/.exec(u.pathname)?.[1] ?? null } },
  { key: "news-jtbc", name: "JTBC", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 news.jtbc.co.kr/rss [사실, 11/08 CC 크롬 확인: item 사회 11·경제 4·정치 14, 기사 링크 news.jtbc.co.kr]. AI 문구 있음(하단 'AI 학습 등 금함'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://news-ex.jtbc.co.kr/v1/get/rss/section/society", "https://news-ex.jtbc.co.kr/v1/get/rss/section/economy", "https://news-ex.jtbc.co.kr/v1/get/rss/section/politics"],
    hosts: ["news-ex.jtbc.co.kr", "news.jtbc.co.kr"], kindOf: article },
  { key: "news-sbs", name: "SBS", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 news.sbs.co.kr/news/rss.do [사실, 11/08 CC 크롬 확인: 섹션마다 item 29]. 기사 호스트 news.sbs.co.kr는 [추정] — 배포 뒤 probe로 확인.
    // AI 문구 있음('AI학습 이용 금지'), 명진 결정으로 넣음(개인 용도). sectionId 03 사회·02 경제·01 정치.
    extract: false,
    lists: ["https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER", "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER", "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER"],
    hosts: ["news.sbs.co.kr", "mnews.sbs.co.kr"], kindOf: article },
  { key: "news-nocut", name: "노컷뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 nocutnews.co.kr/rss/ [사실, 11/08 CC 크롬 확인: 섹션마다 item 50, 기사 링크 www.nocutnews.co.kr]. AI 문구 있음('AI 학습 및 활용 금지'), 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://rss.nocutnews.co.kr/category/society.xml", "https://rss.nocutnews.co.kr/category/economy.xml", "https://rss.nocutnews.co.kr/category/politics.xml"],
    hosts: ["rss.nocutnews.co.kr", "www.nocutnews.co.kr", "nocutnews.co.kr"], kindOf: article },
  { key: "news-chosun", name: "조선일보", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 공식 안내 쪽 없음 — 사이트 자체 주소(arc outboundfeeds) [사실, 11/08 CC 크롬 확인: 섹션마다 item 100, 기사 링크 www.chosun.com]. AI 문구 없음. 명진 결정으로 넣음(개인 용도).
    extract: false,
    lists: ["https://www.chosun.com/arc/outboundfeeds/rss/category/national/?outputType=xml", "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", "https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml"],
    hosts: ["www.chosun.com", "chosun.com"], kindOf: article },
  // ---- 4차(S56-54, 11/10 NEWS-다받기-새언론사). 같은 규칙: 매체 공식 'RSS 안내' 쪽에 [사실]로 나온 피드 주소만, take 'all'·기본 켬·extract:false.
  //   이 웹 세션은 WebSearch 결과로 나온 안내 쪽을 WebFetch로 열어 확인했다(설계 3.1f 표). 피드 실물은 뉴시스·서울경제 사회 피드만 열림 [사실],
  //   매일신문은 안내 쪽만 [사실]이고 피드·기사 호스트는 배포 뒤 probe(raw·listed)로 CC가 확인했다(11/11 운영: 뉴시스 271·서울경제 146·매일신문 254건 [사실]).
  //   미디어오늘은 같이 넣었으나 그쪽 robots.txt가 `*` 묶음에 `Disallow:/rss/`를 두어(수집 결과 'robots', 0건 [사실: 11/11 CC 운영·크롬 확인]) 카탈로그에서 뺐다(S59-1).
  //   'AI 학습 금지' 문구가 있는 서울경제도 넣는다 — 11/08 명진 결정(개인 용도)과 같은 기준.
  { key: "news-newsis", name: "뉴시스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 www.newsis.com/RSS/ [사실, 11/10]. 사회 피드 열림(RSS 2.0·description 있음·기사 링크 https://www.newsis.com/view/…) [사실].
    // 조건: 하단 '무단 전재·복사·배포 금지', 피드 안 저작권 고지 줄 [사실]. 전체 피드는 없고 속보(sokbo)는 양이 많아 사회·경제·정치만.
    extract: false,
    lists: ["https://www.newsis.com/RSS/society.xml", "https://www.newsis.com/RSS/economy.xml", "https://www.newsis.com/RSS/politics.xml"],
    hosts: ["www.newsis.com", "newsis.com"], kindOf: article },
  { key: "news-sedaily", name: "서울경제", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 안내 쪽 www.sedaily.com/rss [사실, 11/10]: '개인 이용자의 비상업적 사용에만 허용', AI 학습 금지 [사실] → 명진 결정(11/08, 개인 용도)으로 넣음.
    // 사회 피드 열림(RSS 2.0·item 50·description 없음·기사 링크 https://www.sedaily.com/article/…) [사실].
    extract: false,
    // S69-06(실측): 기사 본문 칸 `#article-body`(흔한 본문 칸 `article-content`는 머리·요약 줄을 먼저 담아 앞부분만 남았다).
    bodyClass: /^article-body$/,
    lists: ["https://www.sedaily.com/rss/society", "https://www.sedaily.com/rss/economy", "https://www.sedaily.com/rss/politics"],
    hosts: ["www.sedaily.com", "sedaily.com"], kindOf: article },
  { key: "news-imaeil", name: "매일신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true, sections: ["society", "economy", "politics"],
    // 대구 지역지. 안내 쪽 www.imaeil.com/rss_service [사실, 11/10]: 이용 조건 문구 없음(저작권 표기만) [사실]. 피드는 ?cate= 쿼리(allowedUrl은 호스트만 봄).
    // 기사 호스트 www.imaeil.com(/page/view/…)은 검색 결과로 본 주소 [사실], 피드 안 링크는 배포 뒤 probe로 확인.
    extract: false,
    lists: ["https://www.imaeil.com/rss?cate=society", "https://www.imaeil.com/rss?cate=economy", "https://www.imaeil.com/rss?cate=politics"],
    hosts: ["www.imaeil.com", "imaeil.com"], kindOf: article },
  { key: "news-psi", name: "PSI", group: "foreign", region: "foreign", lang: "en", mode: "rss", beat: "labor",
    extract: { version: 1 },
    lists: ["https://publicservices.international/feed.xml"], hosts: ["publicservices.international"], kindOf: article },
  { key: "news-itf", name: "ITF", group: "foreign", region: "foreign", lang: "en", mode: "rss", beat: "labor",
    extract: { version: 1 },
    lists: ["https://www.itfglobal.org/en/rss/feed"], hosts: ["www.itfglobal.org", "itfglobal.org"], kindOf: article },
  { key: "news-labourstart", name: "LabourStart(아시아)", group: "foreign", region: "foreign", lang: "en", mode: "rss", beat: "labor",
    // 링크가 남의 매체라 허용 호스트 밖 — 본문은 읽지 않고 failed/off_host(4.3절). 규칙은 판 번호만.
    // S51-9: 피드 글 링크가 모두 허용 호스트 밖이면 parseFeed가 다 빼서 기사 줄 자체가 0건이었다(probe는 off_host로 보고).
    // S57-13(11/11 명진 '제목만이라도'): linkOut — 기사 줄은 남긴다(제목·날짜·링크). 남의 매체 글 쪽은 지금처럼 읽지 않는다.
    linkOut: true,
    extract: { version: 1 },
    lists: ["https://www.labourstart.org/rdf/labourstart.asia.rss"], hosts: ["www.labourstart.org", "labourstart.org"], kindOf: article },
  // ---- 5차(S59-1, 11/11 NEWS-못넣은곳대안 뒤처리). 11/11 15:25~15:40 CC가 크롬으로 robots.txt(`User-agent: *` 묶음)와 피드를 직접 열어 확인한 6곳 [사실].
  //   S57-13에서 구글 뉴스 매체 단위 줄로 넣었던 매체를 자기 RSS 줄로 바꿨다(구글 뉴스 길은 robots 금지 — 위 머리 주석). 키와 자리(순서)는 그대로 — 켬·끔 설정과 색이 그대로다.
  //   규칙은 4차와 같다: take 'all'·기본 켬·extract:false(수집 때 글 쪽은 읽지 않음 — 제목·소개·날짜·링크만, 11/11 '제목만이라도').
  //   매체가 'RSS 안내' 쪽을 두지 않은 피드(레디앙·철도경제신문·머니투데이)도 확인 뒤 넣는다 — 11/11 명진 결정("ㅇㅇ").
  { key: "news-worknworld", name: "노동과세계", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // robots `/admin/`만 금지 [사실]. 피드는 https로 열림(50건) [사실], 글 링크는 http://worknworld.kctu.org/… [사실] → httpsLinks로 같은 호스트 링크만 https로 받는다.
    extract: false, httpsLinks: true,
    lists: ["https://worknworld.kctu.org/rss/allArticle.xml"], hosts: ["worknworld.kctu.org"], kindOf: article },
  { key: "news-newsmin", name: "뉴스민", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // robots `*` Allow: / [사실]. 워드프레스 피드가 쿠키 없이 열림(12건, 글 링크 https://www.newsmin.co.kr/news/숫자/) [사실: 크롬].
    // 기사 쪽은 봇 확인(쿠키 확인 뒤 넘기는 빈 쪽)이 있었다 [기록] — 서버에서 피드도 그 확인에 걸리는지는 배포 뒤 probe(raw)로 본다. 봇 확인은 풀지 않는다.
    extract: false,
    lists: ["https://www.newsmin.co.kr/news/feed/"], hosts: ["www.newsmin.co.kr", "newsmin.co.kr"], kindOf: article },
  { key: "news-redaily", name: "철도경제신문", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // robots `/admin/`만(GPTBot만 전체 금지 — 우리 이름은 `*` 묶음) [사실]. 피드 50건·글 링크 https [사실]. 유료 기사도 제목·링크는 받는다.
    extract: false,
    lists: ["https://www.redaily.co.kr/rss/allArticle.xml"], hosts: ["www.redaily.co.kr", "redaily.co.kr"], kindOf: article },
  { key: "news-laborplus", name: "참여와혁신", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // 홈 하단 공식 RSS 링크(rssIndex.html) [사실]. robots `/admin/`만 [사실]. 전체 피드 50건·글 링크 https://www.laborplus.co.kr/… [사실].
    extract: false,
    // S69-06(실측 GitHub 러너): 엔디소프트 기사 쪽. 본문 칸 `#article-view-content-div`를 고정하지 않으면 앞의 짧은 <article>(머리)에서 멈춰 앞부분만 남았다.
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.laborplus.co.kr/rss/allArticle.xml"], hosts: ["www.laborplus.co.kr", "laborplus.co.kr"], kindOf: article },
  { key: "news-redian", name: "레디앙", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // robots `/admin/`만 [사실]. 전체 피드 50건·글 링크 https [사실].
    extract: false,
    // S69-06(실측 GitHub 러너): 엔디소프트 기사 쪽. 본문 칸 `#article-view-content-div`를 고정하지 않으면 앞의 짧은 <article>(머리)에서 멈춰 앞부분만 남았다.
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.redian.org/rss/allArticle.xml"], hosts: ["www.redian.org", "redian.org"], kindOf: article },
  { key: "news-mt", name: "머니투데이", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", mixedAs: "economy", on: true,
    // 피드 https://rss.mt.co.kr/mt_news.xml 살아 있음, 글 링크 https://www.mt.co.kr/… [사실]. rss.mt.co.kr/robots.txt는 www.mt.co.kr의 없는 쪽(404)으로 넘긴다 [사실]:
    // 수집기는 허용 호스트(https) 안의 넘김만 따라가고, 따라간 끝이 404면 robots.txt가 없는 것(전부 허용)으로 본다(feed-fetch readRobots, 표준 RFC 9309). 하루 글이 많다(약 560건).
    extract: false,
    lists: ["https://rss.mt.co.kr/mt_news.xml"], hosts: ["rss.mt.co.kr", "www.mt.co.kr", "mt.co.kr"], kindOf: article },
  // ---- 6차(S71-70 NEWS-수집처더하기·분야, 11/26). 맨 끝 앞에 둔다(앞선 매체 키 순서·돌려쓰기 색 칸 그대로).
  { key: "news-newscham", name: "참세상", group: "movement", region: "domestic", lang: "ko", mode: "rss", beat: "labor", take: "all", on: true,
    // 민중언론(노동·사회운동 전문) → 노동 전문지처럼 거르지 않고 전부(beat labor), '언론' 탭.
    // 홈 머리 공식 피드 링크 https://newscham.net/feed/ [사실: 원문 점검 11/26 — 워드프레스 피드, application/rss+xml·글 10건·글 링크 newscham.net].
    // robots `*` 묶음은 /wp/wp-admin/만 금지 [사실]. www.newscham.net 은 러너에서 robots를 못 읽음(robots_unreachable) — 주소는 www 없는 쪽만.
    extract: false,
    lists: ["https://newscham.net/feed/"], hosts: ["newscham.net"], kindOf: article },
  { key: "news-mediatoday", name: "미디어오늘", group: "movement", region: "domestic", lang: "ko", mode: "html", take: "all", on: true,
    sections: ["politics", "economy", "society", "opinion"],
    // 피드(/rss/)는 그쪽 robots.txt가 막는다 [사실: 11/11·11/26 원문 점검 'robots'] — 우회하지 않는다. 분야 목록 쪽(/news/articleList.html)은 robots가 허용 [사실: 11/26].
    // 매체가 보이는 분야 코드 [사실: 목록 쪽 메뉴]: S1N2 정치 · S1N3 경제 · S1N4 사회(노동·언론·인권 등 하위 분야 포함) · S1N8 오피니언(사설·연재). 문화·IT/과학·세계는 읽지 않는다.
    // 목록 쪽에는 소개 글·피드 날짜가 없어 제목·주소만 받는다(받은 날로 정렬). 글 쪽은 수집 때 읽지 않는다(extract:false, 다른 종합지와 같음).
    extract: false,
    // 기사 쪽은 엔디소프트(목록 쪽 주소 꼴 articleList·articleView [사실]) — 같은 회사 쪽의 본문 칸 `#article-view-content-div`를 고정한다(S69-06 시사IN·레디앙과 같은 까닭: 앞 짧은 <article> 머리에서 멈추지 않게) [추정 — 글 쪽 칸 이름은 배포 뒤 원문 점검으로 확인].
    bodyClass: /^article-view-content-div$/,
    lists: ["https://www.mediatoday.co.kr/news/articleList.html?sc_section_code=S1N2&view_type=sm", "https://www.mediatoday.co.kr/news/articleList.html?sc_section_code=S1N3&view_type=sm",
      "https://www.mediatoday.co.kr/news/articleList.html?sc_section_code=S1N4&view_type=sm", "https://www.mediatoday.co.kr/news/articleList.html?sc_section_code=S1N8&view_type=sm"],
    hosts: ["www.mediatoday.co.kr", "mediatoday.co.kr"],
    item: /^https:\/\/(www\.)?mediatoday\.co\.kr\/news\/articleView\.html\?idxno=\d{1,9}$/,
    canon: (u) => `https://www.mediatoday.co.kr/news/articleView.html?idxno=${u.searchParams.get("idxno")}`,
    kindOf: article },
  // ---- 사설·칼럼(S69 NEWS-사설칼럼 — 맨 끝에 둔다: 앞선 매체의 키 순서·돌려쓰기 색 칸이 그대로, 명진 11/24 "주요 신문 사설 칼럼도 추가해줘요"). region "opinion" — 화면 '사설·칼럼' 묶음.
  //   규칙은 종합지와 같다: take 'all'·기본 켬·extract:false(수집 때 글 쪽은 읽지 않음 — 제목·소개·날짜·링크만, 사람이 열 때 읽기는 다른 매체와 같다).
  //   거르기(news-rank.ts): 섹션 "opinion"은 사회 섹션과 같은 등급 2(노동 낱말이 있으면 1, 부고·운세 같은 꼬리표는 그대로 뺀다).
  //   주소는 매체 공식 RSS 안내 쪽 또는 지금 카탈로그의 같은 매체 피드 꼴에서 찾았고, 실제로 열리는지는 실측 점검(article-extract-live-check, GitHub 러너,
  //   11/24 [사실])으로 확인한 것만 남겼다: 경향·한겨레·조선·세계·한국경제 — 피드 ok, 글 3건씩 전문.
  //   뺀 것(같은 점검): 중앙(rss.joins.com)·한국일보(rss.hankooki.com) 옛 주소는 접속 안 됨, 국민일보(kmibColRss.xml)·매일경제(/rss/30500041/)는 빈 응답(0건),
  //   동아(rss.donga.com/editorials.xml)는 러너에서 확인 불가(지금 쓰는 동아 피드도 같은 러너에서 시간 초과 — 사이트가 러너 접속을 막는 것으로 보임 [추정]).
  //   서울신문·문화일보는 공식 사설 피드 주소를 찾지 못함. 새 주소를 찾으면 한 줄 더하는 작은 PR로.
  //   키는 '신문 키-opinion' — 화면 색은 같은 신문 고유색을 함께 쓴다(app/news-colors.mjs baseKey).
  { key: "news-khan-opinion", name: "경향신문 사설·칼럼", group: "movement", region: "opinion", lang: "ko", mode: "rss", take: "all", on: true, sections: ["opinion"],
    // 안내 쪽 khan.co.kr/help/help_rss.html '오피니언' [사실, 11/24 웹 확인].
    extract: false,
    lists: ["https://www.khan.co.kr/rss/rssdata/opinion_news.xml"], hosts: ["www.khan.co.kr", "khan.co.kr"], kindOf: article },
  { key: "news-hani-opinion", name: "한겨레 사설·칼럼", group: "movement", region: "opinion", lang: "ko", mode: "rss", take: "all", on: true, sections: ["opinion"],
    // 같은 매체 피드 꼴 www.hani.co.kr/rss/<섹션>/ 의 '사설·칼럼'(opinion).
    extract: false,
    lists: ["https://www.hani.co.kr/rss/opinion/"], hosts: ["www.hani.co.kr", "hani.co.kr"], kindOf: article },
  { key: "news-chosun-opinion", name: "조선일보 사설·칼럼", group: "movement", region: "opinion", lang: "ko", mode: "rss", take: "all", on: true, sections: ["opinion"],
    // 같은 매체 피드 꼴(arc outboundfeeds category)의 opinion.
    extract: false,
    lists: ["https://www.chosun.com/arc/outboundfeeds/rss/category/opinion/?outputType=xml"], hosts: ["www.chosun.com", "chosun.com"], kindOf: article },
  { key: "news-segye-opinion", name: "세계일보 사설·칼럼", group: "movement", region: "opinion", lang: "ko", mode: "rss", take: "all", on: true, sections: ["opinion"],
    // 안내 쪽 segye.com/rssInfo '오피니언' [사실, 11/24 웹 확인].
    extract: false,
    lists: ["https://www.segye.com/Articles/RSSList/segye_opinion.xml"], hosts: ["www.segye.com", "segye.com"], kindOf: article },
  { key: "news-hankyung-opinion", name: "한국경제 사설·칼럼", group: "movement", region: "opinion", lang: "ko", mode: "rss", take: "all", on: true, sections: ["opinion"],
    // 같은 매체 피드 꼴 hankyung.com/feed/<섹션>의 opinion.
    extract: false,
    lists: ["https://www.hankyung.com/feed/opinion"], hosts: ["www.hankyung.com", "hankyung.com"], kindOf: article },
] as NewsSource[]);

export const NEWS_SOURCE_KEYS: readonly string[] = Object.freeze(NEWS_CATALOG.map((s) => s.key));
export function newsSourceByKey(key: unknown): NewsSource | null {
  return typeof key === "string" ? NEWS_CATALOG.find((s) => s.key === key) ?? null : null;
}
export function publicNewsCatalog() {
  return NEWS_CATALOG.map((s) => ({ key: s.key, name: s.name, region: s.region, lang: s.lang, on: s.on === true }));
}

// 키워드 글자 맞추기(AI 없이 글자 일치, 대소문자·앞뒤 공백 무시): 제목+소개에 키워드 낱말이 글자 그대로 들어 있으면 그 낱말.
// 쓰는 곳: take=keywords 매체의 글 거르기, 받은 글의 키워드 표시(news-feed runMedia·runKeywords, S59-1 — 키워드 찾기는 이것뿐이다).
export function matchedKeywords(text: string, words: readonly string[]): string[] {
  const hay = text.toLowerCase();
  const out: string[] = [];
  for (const w of words) {
    const k = w.trim().toLowerCase();
    if (k && hay.includes(k) && !out.includes(w)) out.push(w);
  }
  return out;
}
