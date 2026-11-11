# 구글 뉴스 매체 단위 14곳이 0건인 까닭과 뒤처리 (NEWS-못넣은곳대안 뒤처리, S58-9)

2026-11-11. 대상: `supabase/functions/_shared/news-catalog.ts`의 `googleSite(...)` 줄 14곳(#2365·#2367)과 `news-nocut`.

표기: [사실] = 이 세션이 직접 읽은 것(코드·시험·연 쪽), [제3자] = 남이 적어 둔 것을 읽은 것, [운영] = CC가 운영에서 읽어 지시서에 적어 준 것, [기록] = 앞 세션이 `news-clipping.md` 3.1f에 [사실]로 적어 둔 것, [추정] = 근거는 있으나 직접 못 본 것.

## 1. 한 줄 결론

**구글 뉴스 사이트(`news.google.com`)의 robots.txt가 검색 RSS 경로(`/rss/search`)를 모든 자동 읽기에 금지하고 있다 [제3자 2건 + 운영 기록과 일치].** 우리 수집기의 robots 해석(`robotsAllows`)이 틀린 것이 아니라 **실제 금지**다. 그래서 14곳은 구글 뉴스 길로는 한 건도 들어올 수 없고, 같은 주소를 쓰는 **키워드 찾기도 같은 까닭으로 막혀 있을 것이다 [추정 — 3절, 운영 조회 한 번이면 닫힘]**.

- robots를 무시하거나 수집기 이름을 속이는 길은 쓰지 않는다(`outside-catalog.ts` 'robots 예외 없음' 원칙 그대로).
- **14곳 가운데 실제로 글이 들어올 길이 생긴 곳: 0곳.** 이 세션 도구는 매체 피드·robots.txt 주소를 열 수 없어(8절) 다른 길을 [사실]로 확인하지 못했다. 가능성이 있는 곳은 4곳(참여와혁신·머니투데이·이데일리·레디앙, 그리고 낮은 가능성으로 철도경제신문)이고, 확인할 주소와 확인 뒤 바꿀 줄을 6·7절에 적었다.
- 이 PR이 바꾼 것은 시험 2개(실제 모양의 robots 글로 판정을 고정)와 카탈로그 주석 한 덩어리, 이 문서다. 수집 동작은 그대로다.

## 2. 사실

### 2.1 운영 기록 [운영: CC V58 읽기 조회 11/11 13:52]

- 11/11 13:22 수집에서 `app_outside_sources`의 `news-worknworld`·`news-newsmin`·`news-redaily`·`news-busan`·`news-laborplus`·`news-redian`이 차례로 `last_error='robots'`, `last_ok_at` 없음. `news-mediatoday`도 아침부터 `robots`.
- `app_news_items`에 이 14개 키 글은 0건. 같은 수집에서 자기 RSS 매체는 1,074건.
- `news-nocut`은 11/09부터 `robots_unreachable`.

### 2.2 코드가 읽는 주소와 판정 차례 [사실: 코드]

- 14곳이 읽는 주소는 매체마다 하나: `https://news.google.com/rss/search?q=site:<도메인> when:1d&hl=ko&gl=KR&ceid=KR:ko`(`googleSiteUrl`).
- 읽기 전에 `makeFeedReader.get`(`_shared/feed-fetch.ts`)이 `https://news.google.com/robots.txt`를 먼저 읽고, `robotsAllows(robots 글, "Web2NewsFeed", 경로+검색어)`가 거짓이면 요청을 보내지 않고 `robots`를 돌려준다. 매체 단계(`runMedia`)는 그 값을 `last_error`에 적는다.
- `last_error='robots'`가 남으려면 ① robots.txt가 200으로 읽혔고 ② 그 글이 `/rss/search?...`를 우리 이름 또는 `*` 묶음에서 막아야 한다. robots.txt를 못 읽었으면 `robots_unreachable`, 401·403이면 `robots_denied`가 남는다(다른 값). 즉 **운영의 `robots`는 "구글 robots.txt를 읽었고 그 글이 막았다"는 뜻**이다.

### 2.3 news.google.com/robots.txt 내용

- 이 세션 도구는 그 주소를 직접 열지 못했다(주소 승인 대기에서 멈춤 — 다른 길로 돌려 읽지 않았다) [사실].
- 남이 적어 둔 것 2건 [제3자]:
  - 2026-09-07 공개 저장소 이슈(`agile-explorations/democracy-monitor` #860): robots.txt가 `User-agent: *` / `Disallow: /`이고 짧은 Allow 목록(`/$`, `/home`, `/topics/`, `/publications/`, `/stories/`, `/swg/` …)만 있으며 **`/rss/search`는 Allow 목록에 없다**.
  - 2026-10-21 공개 저장소 PR(`GHAZMOTIEBIPRO/GHAZIBOT` #338): 같은 robots.txt를 `User-agent: *` / `Disallow: /`로 적고 **`/rss/`에 Allow 규칙 없음**. 구글 약관의 "robots.txt 같은 기계가 읽는 지시를 어기는 자동 접근 금지" 문구도 함께 적음.
- 두 기록과 운영 기록(2.1·2.2)이 서로 맞는다. **CC가 크롬으로 `https://news.google.com/robots.txt`를 한 번 열어 `Allow: /rss`로 시작하는 줄이 없는지 보면 [사실]로 닫힌다**(7절 ①).

### 2.4 우리 해석(`robotsAllows`)은 맞는가 [사실: 코드·시험]

`supabase/functions/outside-feed/parse.ts`의 `robotsAllows`는 표준(RFC 9309)대로다.

| 규칙 | 표준 | 우리 코드 |
| --- | --- | --- |
| 묶음 고르기 | 내 이름과 맞는 묶음이 있으면 그것, 없으면 `*` | 같음 |
| 여러 규칙이 맞을 때 | 가장 긴(구체적인) 규칙이 이김, 길이가 같으면 Allow | 같음 |
| `*`·`$` | `*`는 아무 글자, `$`는 끝 | 같음 |
| 검색어(`?` 뒤) | 경로+검색어 전체를 규칙과 견줌 | 같음(`pathname + search`) |

2.3의 글(`Disallow: /` + `Allow: /$`·`/home`·…)에 `/rss/search?q=…`를 넣으면 맞는 규칙은 `Disallow: /`(길이 1) 하나뿐이다. `Allow: /$`는 끝 표시(`$`) 때문에 `/` 한 글자 주소에만 맞고, 나머지 Allow는 앞머리가 다르다. → **금지**가 맞는 판정이다.

- 해석을 고칠 것이 없으므로 `robotsAllows`와 `feed-fetch.ts`의 robots 판정 줄은 **바꾸지 않았다**. 공용 판정이 그대로라 다른 매체·단체 수집(뉴스 자기 RSS 매체, 사회운동 Now 단체)에서 허용이던 곳이 막히거나 막힌 곳이 열리는 일은 없다(영향 0곳).
- 이번에 더한 시험(`tests/news-feed-default-on.test.mjs`)이 2.3 모양의 글로 이 판정을 고정한다: 허용 목록 경로는 열리고, 검색 RSS는 14곳·키워드 모두 금지이며, `Allow: /rss/` 줄이 있는 글이면 같은 함수가 연다(막는 까닭이 해석이 아니라 그 줄이 없어서임을 보임).
- 앞선 시험들이 구글 robots를 `User-agent: *\nAllow: /rss/`로 **지어내** 썼기 때문에 시험은 통과하고 운영에서만 0건이었다 [사실: `gSites`]. 실제 글을 열어 보지 못한 채 넣은 것이 처음 원인이다.

## 3. 키워드 찾기는 왜 달라 보였나 [사실: 코드 / 운영 확인 필요]

- 키워드 찾기(`runKeywords`, `handler.ts`)가 읽는 주소는 `https://news.google.com/rss/search?q="키워드" when:1d&hl=ko&gl=KR&ceid=KR:ko` — **호스트·경로가 14곳과 같고 검색어만 다르다**. 읽기 부품(`readers.catalog`)·robots 판정도 같다. 2.3의 글은 검색어와 상관없이 `/rss/search` 전체를 막으므로 키워드 찾기도 같은 `robots`가 나와야 한다(더한 시험이 이 판정을 고정).
- 다르게 보인 까닭은 **기록 방식**이다. 매체 단계는 실패를 `app_outside_sources.last_error`에 적어 '읽지 못함'으로 보이지만, 키워드 단계는 실패를 Edge 로그(`keyword_read_failed`, 코드만)에만 남기고 `robots`면 그 실행의 키워드 읽기를 조용히 그만둔다(`break`). **DB·화면 어디에도 표시가 없다.** '키워드는 된다'는 운영 근거는 이 저장소에 없다(설계 문서의 "키워드 검색에 걸린 글만 들어왔다"는 설계 설명이고 건수 기록이 아니다).
- CC 읽기 조회로 닫을 것(7절 ②): `app_news_items`의 `lane='keyword'` 글이 최근 며칠 사이 들어왔는지(건수·가장 최근 `created_at`), Edge 로그 `keyword_read_failed`의 `code`. 0건·`robots`면 "키워드 찾기는 처음부터(또는 구글이 robots를 바꾼 뒤로) 한 건도 못 가져왔다"가 [사실]이 된다.

## 4. 매체별 다른 길

**읽는 법**: '구글 뉴스 길'은 14곳 모두 같다 — 금지(1절). 아래는 그 밖의 허용된 길(자기 RSS)을 찾은 결과다. 이 세션은 피드·robots.txt 주소를 열지 못해(8절) **[사실]로 "된다"고 확인한 곳은 없다.** '판정' 칸은 지금 아는 것으로 본 가능성이고, 마지막 칸의 확인(7절)이 끝나야 바꿀 수 있다.

| # | 매체(key) | 자기 RSS — 지금 아는 것 | 판정 | 까닭·다음 한 걸음 |
| --- | --- | --- | --- | --- |
| 1 | 참여와혁신(`news-laborplus`) | 홈(https)이 열리고 하단에 공식 RSS 링크 `https://www.laborplus.co.kr/rssIndex.html` [사실: 11/11 이 세션]. 안내 쪽·피드는 못 엶. 피드 주소 `https://www.laborplus.co.kr/rss/allArticle.xml` [추정: 같은 제작 도구(엔디소프트)의 안내 쪽은 '전체기사'를 이 경로로 적는다 — 다른 엔디소프트 매체 안내 쪽에서 확인 [사실], 카탈로그의 매일노동뉴스·비마이너도 이 경로다 [사실: 카탈로그]] | **가능성 높음** | robots·피드 확인(7절 ③). 맞으면 6.2의 한 줄로 바꾼다 |
| 2 | 머니투데이(`news-mt`) | 사이트에서 공식 RSS 링크는 못 찾음 [기록]. 피드 `https://rss.mt.co.kr/mt_news.xml`이 살아 있음 — https, 최신 글 11/11, 하루 약 563건, 글 링크 `www.mt.co.kr` [제3자: 공개 RSS 구독 서비스의 피드 안내 쪽, 11/11] | **가능성 있음** | robots·피드 확인(7절 ④) + 6.1의 2번(매체가 안내하지 않는 피드) 결정. 하루 글이 많다 |
| 3 | 이데일리(`news-edaily`) | 섹션 쪽 하단 공식 RSS 링크가 `http://rss.edaily.co.kr/edaily_news.xml` — **http 주소** [기록]. 그 피드는 살아 있음 — 하루 약 245건, 글 링크 `https://www.edaily.co.kr/News/Read?...` [제3자: 같은 서비스, 11/11]. https로도 열리는지 모름 | **https로 열리면 가능** | 수집기는 https만 읽는다(보안 시험). `https://rss.edaily.co.kr/…`가 열리는지·robots 확인(7절 ⑤). http만 되면 안 됨 |
| 4 | 레디앙(`news-redian`) | 기사 쪽(https, `/news/articleView.html`)에 RSS 링크 없음 [기록]. 주소 모양이 엔디소프트라 `https://www.redian.org/rss/allArticle.xml`이 있을 수 있음 [추정] | **모름(가능성 있음)** | robots·피드 확인(7절 ⑥) + 6.1의 2번 결정 |
| 5 | 철도경제신문(`news-redaily`) | 기사 쪽에 RSS 링크 없음, 유료 기사 있음 [기록]. 제작 도구 미확인 — 표준 피드 주소가 있는지 모름 [추정 근거 약함] | **모름(가능성 낮음)** | robots·피드 확인(7절 ⑦) + 6.1의 2번 결정 |
| 6 | 미디어오늘(`news-mediatoday`) | 공식 피드 `/rss/allArticle.xml` 있음 [기록]. 그쪽 robots.txt가 우리 수집기를 막음 — RSS 줄일 때 `robots`·0건 [운영: 11/11 09:20] | **안 됨** | 자기 RSS·구글 뉴스 두 길 모두 robots 금지. 그쪽 robots.txt가 무엇을 막는지(전부인지 `/rss`만인지)는 원문을 봐야 안다(7절 ⑧, 급하지 않음) |
| 7 | 노동과세계(`news-worknworld`) | 사이트가 https 주소를 http로 넘긴다(302) [기록] | **안 됨** | 수집기는 https만 읽는다. http를 허용하는 것은 보안 규칙을 낮추는 일이라 권하지 않는다 |
| 8 | 뉴스민(`news-newsmin`) | 기사 쪽이 봇 확인(쿠키 확인 뒤 넘기는 빈 쪽) [기록] | **안 됨으로 봄** | 봇 확인은 풀지 않는다. 피드 주소도 같은 확인에 걸릴 가능성이 크다 [추정] |
| 9 | 뉴스1(`news-newsone`) | 사이트 한정 검색·노동 섹션 쪽에 RSS 링크 없음 [기록], 공개 RSS 구독 서비스 검색에서도 피드를 못 찾음 [사실: 11/11 검색] | **길 못 찾음** | 공식 RSS 없음 |
| 10 | 부산일보(`news-busan`) | 기사 쪽에 RSS 링크 없음 [기록], 공개 RSS 구독 서비스 검색에서도 피드를 못 찾음 [사실: 11/11 검색] | **길 못 찾음** | 공식 RSS 없음 |
| 11 | 국제신문(`news-kookje`) | 홈에 RSS 링크 없음, 검색에 http 주소 위주 [기록] | **길 못 찾음** | 공식 RSS 없음 |
| 12 | 경기일보(`news-kyeonggi`) | 기사 쪽 하단에 RSS 링크 없음 [기록] | **길 못 찾음** | 공식 RSS 없음 |
| 13 | 경인일보(`news-kyeongin`) | 홈·기사 쪽에 RSS 링크 없음 [기록] | **길 못 찾음** | 공식 RSS 없음 |
| 14 | 영남일보(`news-yeongnam`) | 홈에 RSS 링크 없음 [기록] | **길 못 찾음** | 공식 RSS 없음 |
| — | 노컷뉴스(`news-nocut`) | 공식 안내 쪽 `https://www.nocutnews.co.kr/rss/`가 지금도 같은 피드 주소(`https://rss.nocutnews.co.kr/category/…xml`)를 적고 있음 — 주소는 안 바뀜 [사실: 11/11 이 세션] | **피드는 그대로, robots.txt를 못 읽는 중** | `robots_unreachable`은 피드 호스트 `rss.nocutnews.co.kr`의 `/robots.txt` 요청이 연결 실패·시간 초과, 허용 밖 주소(또는 http)로 넘김, 5xx 같은 응답, 몸통 끊김 가운데 하나라는 뜻이다 [사실: 코드 `readRobots`]. 어느 것인지는 Edge 로그 `robots_unreachable`의 `why`로만 가른다(7절 ⑨). 구글 뉴스 문제와는 다른 일이다 |

- **사이트맵·목록 쪽 길**: 14곳 가운데 RSS가 없는 곳은 사이트맵(robots.txt의 `Sitemap:` 줄)이 남은 허용 길일 수 있다. 그러나 수집기는 RSS만 읽는다 — 사이트맵을 읽으려면 새 해석 부품이 필요하고, 목록 쪽(HTML)을 긁는 것은 설계에서 하지 않기로 했다(`news-clipping.md` 3절 "페이지 긁기는 하지 않는다"). 그래서 이 PR에서는 만들지 않고 6.1의 4번 결정으로 둔다.
- **요약**: 가능성 있는 곳 4곳(참여와혁신·머니투데이·이데일리·레디앙) + 낮은 가능성 1곳(철도경제신문), 안 되는 곳 3곳(미디어오늘·노동과세계·뉴스민), 길을 못 찾은 곳 6곳(뉴스1·부산일보·국제신문·경기일보·경인일보·영남일보).

## 5. 화면 — 지금 어떻게 보이나(확인만) [사실: 코드]

- **매체 선택 칸**: 켠 매체가 실패하면 이름 옆에 붉은 글씨로 '읽지 못함' 한 마디가 보인다(`app/news-clipping-model.mjs` `sourceNote`, `news-clipping.css` `.nc-faint.is-bad`). 한 번도 못 읽은 14곳도 첫 수집 뒤에는 '읽지 못함'으로 보인다. 까닭(그쪽이 자동 읽기를 막은 것인지, 잠깐의 장애인지)은 안 보이고, **이 칸을 열어야만** 보인다.
- **뉴스 목록**: 14곳 글이 0건이어도 목록에는 아무 표시가 없다(다른 매체 글에 섞여 빈 자리가 드러나지 않는다).
- **키워드 칸**: 키워드 찾기가 막혀도 표시가 전혀 없다(3절). 키워드를 넣어 둔 사람은 "맞는 기사가 없나 보다"로 읽게 된다.
- **수집 시간**: 길이 막힌 14곳도 매 수집마다 일 하나씩 차지한다(구글 robots.txt만 읽고 끝). 설계 문서 3.1g의 계산으로 한 번 수집이 약 13분 길어져 있다 [추정: 그 문서].
- 고치는 것은 사용자가 6.1에서 고른 뒤 다른 작업으로 한다(이 PR은 화면을 바꾸지 않았다).

## 6. 사용자가 고를 것

### 6.1 고를 것(일상어)

1. **길이 없는 매체를 어떻게 둘까** — 미디어오늘·노동과세계·뉴스민과 RSS가 없는 6곳(뉴스1·부산일보·국제신문·경기일보·경인일보·영남일보).
   - (가) 매체 선택 창에서 뺀다. 창이 짧아지고 수집이 그만큼 빨라진다. 나중에 길이 생기면 다시 넣는다. **권함** — 쓰지 못하는 것은 숨기지 않고 지운다는 기준과 맞다.
   - (나) 창에 남기고 '가져올 수 없음'이라고 적는다(켜고 끄는 단추는 없앤다). 어떤 매체가 왜 빠졌는지 창에서 보인다.
   - (다) 지금처럼 둔다('읽지 못함'이 계속 붉게 보인다).
2. **매체가 안내하지 않는 피드 주소를 써도 되나** — 머니투데이·레디앙·철도경제신문. 사이트에 'RSS' 안내는 없지만 피드 주소가 열릴 수 있다. 확인해서 열리고 그쪽 robots가 허용하면 넣을지(조선일보를 넣을 때와 같은 판단). 참여와혁신·이데일리는 매체가 직접 안내하는 주소라 이 결정이 필요 없다.
3. **키워드 찾기를 어떻게 할까** — 구글 뉴스 길이 막혀 키워드로는 새 글이 안 들어온다(7절 ② 확인 뒤).
   - (가) 키워드 칸을 화면에서 뺀다.
   - (나) '받아 온 매체 글 가운데 키워드가 든 글만 모아 보기'로 바꾼다(밖에서 새로 찾지 않고, 이미 받은 글에서 고른다). 새 작업이다.
   - (다) 그대로 두고 '지금은 찾지 못함'이라고 적는다.
4. **RSS가 없는 매체를 사이트맵으로 받아 볼까** — 새 부품이 필요하고, 매체마다 robots.txt 원문을 먼저 봐야 한다. 지금은 **하지 않기를 권함**(6곳 모두 지역지·통신사라 다른 매체 글과 많이 겹친다).
5. **'읽지 못함'에 까닭을 한 마디 붙일까** — 예: '그쪽에서 자동 읽기를 막음' / '잠깐 연결 안 됨'. 1번을 (가)로 고르면 급하지 않다.

### 6.2 확인되면 바꿀 줄(다음 작은 PR)

확인(7절)이 끝난 매체만, 카탈로그의 그 줄을 같은 자리에서 아래 모양으로 바꾼다. **키와 자리(순서)는 그대로** 둔다 — 켬·끔 설정과 다른 매체의 색 칸이 바뀌지 않는다. 주소·호스트는 7절에서 실제로 본 값으로 적는다(아래는 지금 아는 값).

```ts
  { key: "news-laborplus", name: "참여와혁신", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    extract: false,
    lists: ["https://www.laborplus.co.kr/rss/allArticle.xml"], hosts: ["www.laborplus.co.kr", "laborplus.co.kr"], kindOf: article },
  { key: "news-mt", name: "머니투데이", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    extract: false,
    lists: ["https://rss.mt.co.kr/mt_news.xml"], hosts: ["rss.mt.co.kr", "www.mt.co.kr", "mt.co.kr"], kindOf: article },
  { key: "news-edaily", name: "이데일리", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all", on: true,
    extract: false,
    lists: ["https://rss.edaily.co.kr/edaily_news.xml"], hosts: ["rss.edaily.co.kr", "www.edaily.co.kr", "edaily.co.kr"], kindOf: article },
```

같은 PR에서 고칠 시험: `tests/news-feed-default-on.test.mjs`의 `GOOGLE_SITES` 표(옮긴 매체를 뺀다)와 카탈로그 시험의 "미디어오늘 사이트 주소 없음" 같은 줄 단위 검사. Edge `news-feed` 재배포 뒤 probe로 `raw`·`listed`를 본다(`raw`는 큰데 `listed`가 0이면 글 링크가 http이거나 호스트가 다른 것).

## 7. CC 확인 목록

크롬으로 여는 주소는 모두 읽기만 한다. 번호는 급한 순서다.

| # | 볼 것 | 방법 | 맞으면 |
| --- | --- | --- | --- |
| ① | 구글 뉴스 robots.txt에 `Allow: /rss`로 시작하는 줄이 없고 `User-agent: *` 묶음에 `Disallow: /`가 있는지 | `https://news.google.com/robots.txt` 열기 | 2.3이 [사실]로 닫힌다. 반대로 `/rss` 허용 줄이 **있으면** 이 문서의 결론이 틀린 것이니 그 원문을 PR 댓글로 — 그때는 해석(`robotsAllows`)을 다시 본다 |
| ② | 키워드 찾기가 실제로 글을 가져왔는지 | 읽기 조회: `app_news_items`에서 `lane='keyword'` 건수와 가장 최근 `created_at`(최근 7일). Edge 로그 `keyword_read_failed`의 `code` | 0건·`robots`면 3절이 [사실]. 6.1의 3번 결정으로. 반대로 최근 글이 **들어오고 있으면** 구글 robots 글이 검색어에 따라 다르게 막는다는 뜻이니 ①의 원문과 함께 PR 댓글로 — 그때는 이 문서의 결론을 다시 본다 |
| ③ | 참여와혁신 | `https://www.laborplus.co.kr/robots.txt`(`*` 묶음이 `/rss/`를 막지 않는지) · `https://www.laborplus.co.kr/rss/allArticle.xml`(글이 있고 글 링크가 `https://www.laborplus.co.kr/…`인지) | 6.2 한 줄 |
| ④ | 머니투데이 | `https://rss.mt.co.kr/robots.txt` · `https://rss.mt.co.kr/mt_news.xml`(글 링크 호스트) | 6.1의 2번 결정 뒤 6.2 한 줄 |
| ⑤ | 이데일리 | `https://rss.edaily.co.kr/edaily_news.xml`이 **https로** 열리는지 · `https://rss.edaily.co.kr/robots.txt` | 6.2 한 줄. http로만 열리면 안 됨으로 옮긴다 |
| ⑥ | 레디앙 | `https://www.redian.org/robots.txt` · `https://www.redian.org/rss/allArticle.xml` | 6.1의 2번 결정 뒤 한 줄(참여와혁신과 같은 모양) |
| ⑦ | 철도경제신문 | `https://www.redaily.co.kr/robots.txt` · `https://www.redaily.co.kr/rss/allArticle.xml` | 위와 같음. 404면 길 못 찾음으로 옮긴다 |
| ⑧ | 미디어오늘 robots.txt가 막는 범위 | `https://www.mediatoday.co.kr/robots.txt` | 전부 금지면 '안 됨' 확정. 급하지 않다 |
| ⑨ | 노컷뉴스 robots.txt를 못 읽는 까닭 | Edge 로그 `robots_unreachable`의 `why` 값 · `https://rss.nocutnews.co.kr/robots.txt` 열어 보기(응답·넘겨 가는 주소) | `why`가 넘김(`redirect_outside`)이면 넘겨 가는 호스트가 https인지 보고 hosts 한 줄, 연결 실패·5xx가 이어지면 따로 판단(`news-clipping.md` 3.1g 끝 줄의 갈래 그대로) |

robots.txt를 볼 때의 기준: 우리 수집기 이름은 `Web2NewsFeed`다. 그 이름의 묶음이 없으면 `User-agent: *` 묶음을 따른다. 피드 경로에 맞는 규칙 가운데 가장 긴 것이 Allow면 허용, Disallow면 금지다(같은 길이면 Allow).

## 8. 이 세션이 한 것·못 한 것

- **한 것**: 운영 기록과 코드 대조(2.2), 구글 robots.txt 내용에 대한 제3자 기록 2건 확인(2.3), 해석 점검과 고정 시험 2개(2.4·3절), 매체 홈·안내 쪽·공개 RSS 구독 서비스 안내 쪽으로 확인한 것(4절), 화면 표시 확인(5절).
- **못 한 것**: 이 세션의 읽기 도구는 검색 결과에 나온 주소만 열 수 있다. `news.google.com/robots.txt`, 매체들의 `/robots.txt`와 피드 주소는 검색 결과에 나오지 않아 **한 곳도 직접 열지 못했다**(주소 승인 대기에서 멈춤 — 명령줄 같은 다른 길로 돌려 읽지 않았다). 그래서 4절에 [사실]로 "된다"고 적은 곳이 없고, 카탈로그 줄도 바꾸지 않았다(카탈로그는 [사실]로 확인된 피드 주소만 넣는다는 기준 그대로).
- **운영**: 운영 DB·Edge 로그는 읽지 않았다(2.1은 지시서에 적힌 값).

## 9. 확인에 쓴 주소

`github.com/agile-explorations/democracy-monitor/issues/860` · `github.com/GHAZMOTIEBIPRO/GHAZIBOT/pull/338` · `www.google.com/robots.txt`(다른 호스트 — 참고만) · `www.laborplus.co.kr`(홈) · `ccnnews.co.kr/rssIndex.html`(엔디소프트 안내 쪽 모양) · `www.nocutnews.co.kr/rss/` · `feeder.co/discover/…/mt-co-kr` · `feeder.co/discover/…/edaily-co-kr`(전체·경제). 열지 못한 주소: `news.google.com/robots.txt`, `www.laborplus.co.kr/rssIndex.html`, 각 매체 `/robots.txt`·피드 주소 전부.
