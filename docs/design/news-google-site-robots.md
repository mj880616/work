# 구글 뉴스 매체 단위 14곳이 0건인 까닭과 뒤처리 (NEWS-못넣은곳대안 뒤처리, S58-9)

2026-11-11. 대상: `supabase/functions/_shared/news-catalog.ts`의 `googleSite(...)` 줄 14곳(#2365·#2367)과 `news-nocut`.
이 문서는 사실·원인·매체별 표·사용자가 고를 것을 적는다. 표기: [사실] = 이 세션이 직접 읽은 것, [제3자] = 남이 적어 둔 것을 읽은 것, [운영] = CC가 운영에서 읽어 지시서에 적어 준 것, [추정] = 근거는 있으나 직접 못 본 것.

## 1. 한 줄 결론

**구글 뉴스 사이트(`news.google.com`)의 robots.txt가 검색 RSS 경로(`/rss/search`)를 모든 자동 읽기에 금지하고 있다 [제3자 2건 + 운영 기록과 일치].** 우리 수집기의 robots 해석(`robotsAllows`)이 틀린 것이 아니라 실제로 금지다. 그래서 14곳은 구글 뉴스 길로는 한 건도 들어올 수 없고, **같은 주소를 쓰는 키워드 찾기도 같은 까닭으로 막혀 있을 것이다 [추정 — 3절]**.

robots를 무시하거나 수집기 이름을 속이는 길은 쓰지 않는다(`outside-catalog.ts` 'robots 예외 없음' 원칙 그대로).

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
- 두 기록과 운영 기록(2.1·2.2)이 서로 맞는다. **CC가 크롬으로 `https://news.google.com/robots.txt`를 한 번 열어 `/rss`로 시작하는 Allow 줄이 없는지 보면 [사실]로 닫힌다**(6절 CC 확인 목록).

### 2.4 우리 해석(`robotsAllows`)은 맞는가 [사실: 코드·시험]

`supabase/functions/outside-feed/parse.ts`의 `robotsAllows`는 표준(RFC 9309)대로다.

| 규칙 | 표준 | 우리 코드 |
| --- | --- | --- |
| 묶음 고르기 | 내 이름과 맞는 묶음이 있으면 그것, 없으면 `*` | 같음 |
| 여러 규칙이 맞을 때 | 가장 긴(구체적인) 규칙이 이김, 길이가 같으면 Allow | 같음 |
| `*`·`$` | `*`는 아무 글자, `$`는 끝 | 같음 |
| 검색어(`?` 뒤) | 경로+검색어 전체를 규칙과 견줌 | 같음(`pathname + search`) |

2.3의 글(`Disallow: /` + `Allow: /$`·`/home`·…)에 `/rss/search?q=…`를 넣으면: 맞는 규칙은 `Disallow: /`(길이 1) 하나뿐이다. `Allow: /$`는 끝 표시(`$`) 때문에 `/` 한 글자 주소에만 맞고, 나머지 Allow는 앞머리가 다르다. → **금지**가 맞는 판정이다. 해석을 고칠 것이 없으므로 `robotsAllows`·`feed-fetch.ts`의 robots 판정 줄은 바꾸지 않는다(공용 핫스팟 — 다른 매체·단체 수집에 영향 없음).

## 3. 키워드 찾기는 왜 달라 보였나 [사실: 코드 / 운영 확인 필요]

- 키워드 찾기(`runKeywords`, `handler.ts`)가 읽는 주소는 `https://news.google.com/rss/search?q="키워드" when:1d&hl=ko&gl=KR&ceid=KR:ko` — **호스트·경로가 14곳과 같고 검색어만 다르다**. 읽기 부품(`readers.catalog`)·robots 판정도 같다. 2.3의 글은 검색어와 상관없이 `/rss/search` 전체를 막으므로 키워드 찾기도 같은 `robots`가 나와야 한다.
- 다르게 보인 까닭은 **기록 방식**이다. 매체 단계는 실패를 `app_outside_sources.last_error`에 적어 '읽지 못함'으로 보이지만, 키워드 단계는 실패를 Edge 로그(`keyword_read_failed`, 코드만)에만 남기고 `robots`면 그 실행의 키워드 읽기를 조용히 그만둔다(`break`). **DB·화면 어디에도 표시가 없다.** 그래서 '키워드는 된다'고 보였을 뿐, 된다는 운영 근거는 이 저장소에 없다.
- CC 읽기 조회로 닫을 것(6절): `app_news_items`의 `lane='keyword'` 글이 최근 며칠 사이 들어왔는지(건수·가장 최근 `created_at`), Edge 로그 `keyword_read_failed`의 `code`.

## 4. 매체별 다른 길 — 조사 중

14곳과 `news-nocut`의 자체 RSS·robots를 하나씩 확인해 이 절에 표로 채운다(되는 곳 / 안 되는 곳 / 까닭). 이 PR의 다음 커밋에서 채운다.

## 5. 화면 — 지금 어떻게 보이나(확인만) [사실: 코드]

- **매체 선택 칸**: 켠 매체가 실패하면 이름 옆에 '읽지 못함'(붉은 글씨 `is-bad`) 한 마디만 보인다(`app/news-clipping-model.mjs` `sourceNote`). 까닭(robots 금지인지, 잠깐의 장애인지)은 안 보인다. 한 번도 못 읽은 14곳도 '읽지 못함'으로 보인다 — 조용히 비어 보이지는 않지만, **이 칸을 열어야만** 보인다.
- **뉴스 목록**: 14곳 글이 0건이어도 목록에는 아무 표시가 없다(다른 매체 글에 섞여 빈 자리가 드러나지 않음).
- **키워드 칸**: 키워드 찾기가 막혀도 표시가 전혀 없다(3절).
- 고치는 것은 사용자가 6절에서 고른 뒤 다른 작업으로 한다.

## 6. 사용자가 고를 것·CC 확인 목록 — 조사 뒤 채움
