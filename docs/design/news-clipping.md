# 뉴스 클리핑 설계 (NEWS-클리핑, S47-39)

📱 폰 가능 — 이 문서는 설계·조사와 정적 시안만 담는다. 앱 코드·DB·Edge·워크플로·앱 스크립트 변경 없음. SQL 초안도 넣지 않는다(DB PR에서 짝 파일 5개로).

- 작성: 2026-11-01, Claude Code 웹(작업 세션 S47-39). 기준 main `55f9f54`.
- 요청: 명진 결정 11/01 21:14~21:21("ㅇㅇ"). 새 메뉴 '뉴스 클리핑' — 사회운동 Now(`app/outside-statements.js`, Edge `outside-feed`, [outside-statements.md](outside-statements.md))와 같은 틀(하루 3번 읽기, 출처 켜고 끄기, 제목 + 한 줄 요약, 누르면 원문, 같은 저작권 경계)을 다시 쓴다.
- 시안: [mockups/news-clipping.html](mockups/news-clipping.html)(폰 412 · PC 1440, 글은 모두 가짜).
- 표기: [사실] = 저장소 코드·migration 또는 웹에서 직접 확인, [추정] = 주소 모양·제3자 안내·짐작, "확인 못 함". 웹 세션이라 production·운영 DB·robots.txt 원문은 보지 못했다.
- 공개 저장소: 텔레그램 방 이름·번호, 실제 스크랩 내용, 개인정보는 이 문서·시안·코드에 쓰지 않는다. 방 지정은 앱 스크립트 속성에만 둔다.

## 0. 요약과 추천

1. **메뉴**: 사회운동 Now 바로 아래(폰은 더보기 메뉴 같은 자리)에 '뉴스 클리핑' 한 칸. 화면 하나 = 모듈 하나(`app/news-clipping.js`)가 상태를 갖고 그린다(AGENTS §5). 칸은 ① 내 스크랩 ② 키워드 ③ 매체별 새 글, 폰은 좌우 밀기로 칸 이동.
2. **① 내 스크랩은 기존 텔레그램 수집 길을 그대로 탄다**: 회사 PC 수집기 → Drive → 앱 스크립트(매시) → Edge `collector-feed`. 앱 스크립트에 스크립트 속성 `TG_SCRAP_ROOMS`(스크랩 방 지정, 저장소에 값 없음) 하나와 작은 함수 하나를 더하고, `collector-feed`에 입구 `?action=scrap`(같은 비밀값)을 더한다. `collector-feed`는 **링크 검사·저장만** 하고 AI·바깥 읽기는 하지 않는다. 링크의 매체·제목·요약은 아래 새 수집기가 하루 3번 붙인다.
3. **수집기는 새 Edge 함수 `news-feed`** 하나(예약 입구 + 화면 입구, `verify_jwt=false` + 함수 코드 인증 — `outside-feed`와 같은 두 입구). 읽기·robots·크기 상한·RSS 해석·AI 부르기 코드는 **`outside-feed`의 것을 `_shared/`로 옮겨 함께 쓴다**(복사 금지). `outside-feed`를 넓히지 않는 까닭: 그 함수는 "카탈로그 허용 호스트만 읽는다"가 보안 경계인데, 스크랩은 아무 매체 주소나 오므로 경계가 다르다(3.2).
4. **저장**: 새 표 `app_news_items`(세 칸 글 한 표, `lane`으로 구분)·`app_news_keywords`(키워드)·`app_news_days`(하루 AI 사용량). 매체 켜고 끄기는 **기존 `app_outside_sources`를 다시 쓴다**(키 앞에 `news-`). 기사 본문은 저장하지 않는다(제목·매체·시각·주소·AI 한 줄 요약만).
5. **AI**: 내 스크랩(링크마다 1번)과 키워드 기사(10건 묶음에 1번)만. 매체 새 글은 제목만. 하루 약 26~30번·한 달 약 800원 추정, 이 기능 상한 한 달 2,000원(4절).
6. **막힌 곳**: 정책브리핑 RSS는 2026-07-01 서비스 중단 공지 [사실] → 보도자료 목록 쪽 읽기로. Equal Times는 2025-12 발행 중단 [사실] → 뺌. AP·Reuters는 공식 RSS가 없음 [추정] → 매체 칸에 넣지 않음. 구글 뉴스 RSS의 링크는 구글 중계 주소라 원문 주소가 바로 나오지 않음 [제3자 문서] → 키워드 요약 재료가 모자람(결정 N3).

## 1. 지금 있는 것 (사실, 저장소 기준)

| 무엇 | 어디 | 이번에 다시 쓰는 부분 |
| --- | --- | --- |
| 사회운동 Now 화면 | `app/outside-statements.js`·`.css`, 메뉴 `app/menu-model.mjs`(`id:'outside'`)·`app/index.html`·`app/topbar-actions.js` 화면 이름 표 | 글 한 줄 모양(`os-post`: 꼬리 줄 · 제목 · 한 줄 요약 · [원문]), 날짜 묶음 머리, 칩 줄(공용 `app/chip-rows.js`), ⋯ 메뉴 → 출처 켜고 끄기 |
| 수집기 `outside-feed` | `supabase/functions/outside-feed/handler.ts`·`parse.ts`, 카탈로그 `_shared/outside-catalog.ts` | 안전한 GET(2MB·10초·리다이렉트 3번·같은 호스트), robots.txt 읽기(`robotsAllows`), RSS/목록 해석(`parseFeed`·`parseListHtml`), 본문 뽑기(`extractBody`), 봇 확인 쪽 감지(`looksLikeBotCheck`), AI 부르기(`_shared/openai-responses.ts`), 예약 비밀값 고정 길이 비교 |
| 예약 | `.github/workflows/outside-feed.yml`(서울 08·13·18시 7분) | 같은 모양 워크플로 하나 더(`news-feed.yml`, 시각은 몇 분 비켜서) |
| 표 | migration `20261031230000_outside_statements` — `app_outside_sources`(작업공간·`source_key`·켬·마지막 성공·오류), `app_outside_posts`, `app_outside_sentences`, `app_outside_seen` | `app_outside_sources`만 다시 씀(2.2) |
| 텔레그램 수집 | 앱 스크립트 `docs/ops/collector-feed.gs`(매시 트리거, 허용 방 속성 `TG_FEED_ROOMS`·`TG_FEED_ROOMS_EXCLUDE`), Edge `collector-feed`(`x-collector-feed-secret` 비밀값, 텔레그램 묶음 → AI 판정·요약 → `app_feed_items`) | 같은 스크립트·같은 비밀값·같은 함수에 스크랩 입구 하나 |
| AI 한도 | `ai-assist` 한 달 15,000원(`MONTHLY_LIMIT_KRW`), `collector-feed` 6,000원(사용량은 `app_feed_days.ai_*`), 홈 'AI 사용량' 줄(`drive-summary ?action=ai_usage`, `_shared/ai-prices.mjs`) | `collector-feed`와 같은 방식(기능 전용 하루 표 + 기능 상한)으로 `news-feed` 사용량을 따로 세고 홈 줄에 더함 |

- [사실] `outside-feed`는 지금 AI 사용량을 어디에도 기록하지 않는다(`app_ai_*` 참조 0건). 이번 설계 범위 밖 — 범위 밖 발견사항으로 보고.

## 2. 데이터 흐름

```
① 내 스크랩
 명진 → 텔레그램 스크랩 방에 'YYYY-MM-DD HH:MM:SS URL' 한 줄씩
   → 회사 PC 텔레그램 수집기 → Drive 방 폴더                      [사실: 지금 도는 길]
   → 앱 스크립트 매시 실행(한국 0~7시 쉼)                          [사실]
       새 함수 tgScrap_run_: TG_SCRAP_ROOMS 방만 읽음, 줄에서 http(s) 주소만 뽑음
       → POST collector-feed ?action=scrap {items:[{ref, at, url}]}    [제안]
   → collector-feed: 비밀값 확인 → 주소 검사·정리(utm 떼기) → app_news_items(lane=scrap, 상태 '대기') 넣기   [제안, AI 없음]
   → news-feed 예약 실행(하루 3번): 대기 줄마다 원문 쪽 1번 GET → 메타(제목·매체·시각) + 본문(AI 재료로만)
       → AI 한 줄 요약 → 줄 채움(본문은 버림)                          [제안]

② 키워드
 news-feed 예약 실행: 작업공간마다 켠 키워드 → 구글 뉴스 검색 RSS 1번씩 + ③ 매체 피드에서 제목·설명 일치
   → 새 기사만, 같은 기사는 한 줄로 합치고 걸린 키워드를 모음, 내 스크랩에 있는 기사는 뺌
   → 10건 묶음마다 AI 1번(한 줄 요약) → app_news_items(lane=keyword)

③ 매체별 새 글
 news-feed 예약 실행: 켠 매체(카탈로그) RSS 1번씩 → 새 글 제목·주소·시각 → app_news_items(lane=media), AI 없음
```

### 2.1 ① 내 스크랩 길 — 왜 collector-feed인가

| 길 | 내용 | 판단 |
| --- | --- | --- |
| 가. 스크랩 방을 `TG_FEED_ROOMS`에 넣기만 | 지금 텔레그램 소식처럼 방 하루 묶음을 AI가 판정·요약 | ✕ 링크 줄을 '소식'으로 요약해 버림. 기사 하나하나가 줄이 되지 않음, AI 낭비 |
| **나. 같은 앱 스크립트 + `collector-feed ?action=scrap`** | 이미 Drive를 읽는 스크립트가 스크랩 방만 따로 골라 주소 목록을 보냄. 같은 비밀값·같은 입구 함수 | **추천**. 새 비밀값·새 트리거·새 설치 없음(스크립트 붙여 넣기 교체 1번 + 속성 1개) |
| 다. 새 Edge 함수에 텔레그램 봇 웹훅 | 봇이 방 메시지를 바로 받음 | ✕ 새 입구·새 비밀값·봇 권한, 기존 수집기와 겹침 |

- 스크립트 쪽(제안): 속성 `TG_SCRAP_ROOMS`(방 이름·폴더 이름·방 번호, `TG_FEED_ROOMS`와 같은 적는 법). 매시 `tgFeed_run` 끝에 `tgScrap_run_`을 부른다(트리거 추가 없음). 방마다 보낸 가장 큰 메시지 번호를 상태에 두고 새 메시지만. 한 메시지에서 `https?://` 주소를 모두 뽑는다(명진 형식 'YYYY-MM-DD HH:MM:SS URL'이면 앞 날짜·시각을 스크랩 시각으로, 없으면 메시지 시각). 한 번에 50개까지.
- 같은 방이 소식 요약에도 들어가지 않게: `TG_FEED_ROOMS`가 `*`(모든 방)이면 스크랩 방을 `TG_FEED_ROOMS_EXCLUDE`에도 적는다(설치 안내에 넣음, 결정 N5).
- 서버 쪽(제안): `collector-feed ?action=scrap` 몸통 `{items:[{ref, at, url}]}`만, 1~50개, `ref`는 스크립트가 만든 메시지 참조(HMAC, 방 번호 원문 없음), `url`은 `https://`(또는 `http://`) 2000자 안쪽·사용자 정보(`user:pw@`) 없음·`utm_*`·`fbclid` 등 추적 값 뗀 뒤 저장. 작업공간은 서버가 정한다(지금 `collector-feed`와 같음 — 텔레그램은 운영자 전용 기능 `app_workspace_has_feature`, AGENTS §5 D2). 그래서 **① 내 스크랩은 운영자(명진) 작업공간에서만 생긴다**. ②·③은 사람마다 쓸 수 있다.
- 지연: Drive에 들어오는 시간 + 매시 실행 + 하루 3번 채우기 → 올린 뒤 길면 반나절 뒤 제목·요약이 붙는다. 그 사이 화면에는 주소와 '읽는 중'만 보인다. 더 빨리가 필요하면 화면 [지금 채우기](사람마다 하루 10번)로 news-feed 화면 입구를 부른다(결정 N4).

### 2.2 저장 표 (DB PR에서 만듦 — ★정지 지점★, 모양만)

모두 `workspace_id` + RLS 켬 + `private.app_is_workspace_owner(workspace_id)` 소유자 정책, `anon`·`PUBLIC` 권한 없음(기존 Web2 표와 같은 모양). 글 넣기는 Edge(service role)만.

| 표 | 칸(요지) | 화면(authenticated) | service role |
| --- | --- | --- | --- |
| `app_news_items` (새) | `id`, `workspace_id`, `lane`(`scrap|keyword|media`), `url`(정리한 원문 주소, 구글 중계 주소면 그것), `url_key`(겹침 판정용 정규화 주소), `title`(300자), `title_key`(겹침 판정용: 매체 꼬리·공백·문장부호 뗀 제목), `publisher`(매체 이름 80자), `source_key`(③ 카탈로그 키, 없으면 null), `keywords` text[](걸린 키워드, 10개까지), `published_at`, `scrapped_at`(①만), `fetched_at`, `state`(`pending|ok|robots|bot_check|failed|too_big`), `summary_ko`(①·②만, 200자), `ai_basis`(`page|feed|title`: 요약 재료), `hidden_at`(화면에서 지우기). 유일: `(workspace_id, lane, url_key)` | select, update(`hidden_at`)만 | ① 넣기는 `collector-feed`(칸 grant: 대기 줄 칸만), 채우기·②·③ 넣기는 `news-feed` |
| `app_news_keywords` (새) | `workspace_id`, `word`(1~30자), `enabled`, `created_at`, `updated_at`. 유일 `(workspace_id, word)`, 작업공간마다 30개까지(트리거 또는 화면·Edge 검사 — DB PR에서 정함) | select·insert(`workspace_id, word, enabled`)·update(`enabled, updated_at`)·delete | select |
| `app_news_days` (새) | `workspace_id`, `day`, `ai_requests`, `ai_input_tokens`, `ai_output_tokens`, `scrap_n`, `keyword_n`, `media_n` | select | select·insert·숫자 칸 update |
| `app_outside_sources` (기존, **다시 씀**) | ③ 매체 켬/끔을 키 `news-hani`처럼 `news-` 앞머리로 넣음. 키 형식 검사(`^[a-z0-9][a-z0-9-]{1,39}$`)에 맞음 [사실] | 지금 권한 그대로 | 지금 권한 그대로 |

- **`app_outside_posts`를 다시 쓰지 않는 까닭**: `kind` 검사(`statement|comment|press|article`)·국내 글 본문 문장 표·문장 찾기 함수가 '성명 본문 보관'에 묶여 있다 [사실]. 뉴스는 본문을 두지 않고, 겹침 판정(`title_key`)·걸린 키워드·스크랩 시각처럼 칸이 다르다. 기존 표의 검사 제약을 바꾸면 사회운동 Now에도 영향이 가므로, 새 표 하나가 덜 흔든다(AGENTS §4).
- **`app_outside_sources`를 다시 쓸 때 고칠 곳**: `outside-feed`의 `run_plan`은 켜진 키를 모두 읽는다(`handler.ts` 346행) [사실]. `news-` 키를 `sourceByKey`가 모르면 어떻게 되는지는 이 세션에서 끝까지 따라가지 않았다(확인 못 함) → Edge PR에서 `outside-feed`가 카탈로그에 없는 키를 건너뛰는지 시험으로 고정하고, `news-feed`는 `news-` 키만 읽는다. 화면 `app/outside-statements.js`도 `news-` 키를 단체 목록에 섞지 않는지 확인(지금은 카탈로그 기준으로 그림 [추정]).
- [나중 선택] 새 표 이름이 `app_outside_*`가 아니라 헷갈리면 `app_news_sources`를 따로 둘 수도 있다. 추천은 다시 쓰기(표 하나 덜 만듦).
- 크기: 작업공간마다 `lane=media` 줄은 30일, `keyword`는 180일 지나면 news-feed가 지운다(스크랩은 지우지 않음 — 4번 '나중' 학습 재료). 결정 N6.

### 2.3 Edge `news-feed` (Edge PR — ★첫 배포 정지★ + 명진 비밀값 등록)

- `verify_jwt=false` + 함수 코드 인증, 입구 두 개(`outside-feed`와 같음):
  - **예약 입구** `run`: 헤더 `x-news-feed-cron-secret` ↔ 비밀값 `NEWS_FEED_CRON_SECRET`(32자 이상, SHA-256 고정 길이 비교). 어느 작업공간을 읽을지는 서버가 표로 정함.
  - **화면 입구** `catalog`(매체 목록)·`fill_now`(대기 스크랩 바로 채우기, 결정 N4): 사용자 JWT를 Auth 서버로 확인 + 그 사람이 작업공간 owner인지 서버에서 확인. 요청은 키·id만 받고 주소는 받지 않는다.
  - 다른 기능의 비밀 헤더(`x-outside-feed-cron-secret`, `x-collector-feed-secret` 등)가 붙거나 두 입구 열쇠가 함께 오면 401.
- **읽는 주소 경계**(가장 중요):
  - ② 구글 뉴스·③ 매체: 코드 카탈로그(`_shared/news-catalog.ts`)의 허용 호스트만(사회운동 Now와 같은 원칙). 구글 뉴스는 `news.google.com` 한 호스트, 경로 `/rss/search`만, 검색어는 서버가 키워드로 만든다.
  - ① 스크랩 원문: 주소가 명진 손에서 오므로 허용 호스트 목록을 둘 수 없다 → **열린 주소 규칙**: `https`만(`http`는 읽지 않고 주소만 둠), 기본 포트만, 호스트가 IP 숫자·`localhost`·`.local`·`.internal`·`supabase.co`·`supabase.in` 아님, 리다이렉트 3번까지 매 단계 같은 규칙 다시 검사, GET만·쿠키 없음·인증 헤더 없음, 2MB·10초, robots.txt 먼저(막혀 있으면 읽지 않고 `state='robots'`, 화면엔 주소의 도메인만). 이 규칙을 `outside-feed`에는 넣지 않는다(그쪽 경계는 그대로).
  - Supabase Edge 안에서 DNS가 내부 주소로 풀리는 경우를 코드로 막을 방법은 확인 못 함(추정: Edge 런타임이 사설망 접근을 막는다는 공식 문서 확인 필요) → Edge PR 보고에 적는다.
- **공용으로 옮길 코드**(Edge PR 첫 커밋, 동작 변화 없음): `outside-feed/parse.ts`의 `parseFeed`·`robotsAllows`·`extractBody`·`looksLikeBotCheck`·`decodeBody`·`cut`·`oneLine`과 `handler.ts`의 안전 GET(크기·시간·리다이렉트)을 `_shared/feed-fetch.ts`로. `outside-feed`는 거기서 가져다 쓰고 기존 시험이 그대로 통과해야 한다. 옮긴 뒤 `outside-feed`도 다음 배포 때 같은 소스로 재배포(동작 같음, 되돌리기 ref 기록).
- 실행 한 번(예약): ③ 켠 매체 피드 1번씩 → ② 켠 키워드마다 구글 뉴스 1번(요청 사이 2초) + ③에서 읽은 제목·설명 일치 → ① 대기 스크랩 원문 1번씩(최대 20건) → AI(①은 1건 1번, ②는 10건 묶음 1번) → 넣기. 한 사이트를 여러 작업공간이 켜도 한 실행에 한 번만 읽고 나눠 넣는다(사회운동 Now와 같음). 실행 시간 예산 100초.
- 로그·응답에는 건수·키·단계 코드·HTTP 상태만(제목·주소·키워드 없음).
- `docs/web2-env6b-edge-source.md` 5절 표에 `news-feed`(`verify_jwt=false`) 한 줄(Edge PR).

### 2.4 겹침 처리

- 주소 정리: 스킴·호스트 소문자, `www.` 떼기, `utm_*`·`fbclid`·`gclid` 등 추적 값 떼기, 끝 `/` 떼기 → `url_key`. 경향신문 RSS 링크에 utm이 붙어 옴 [사실, 영문판 피드].
- 제목 정리: 구글 뉴스 제목 끝 ` - 매체이름` 떼기, 괄호 머리말(`[단독]` 등)·공백·문장부호 떼기 → `title_key`.
- ② 키워드 줄을 넣기 전에 같은 작업공간 ① 스크랩에 `url_key` 또는 (`title_key` + `publisher`)가 같은 줄이 있으면 넣지 않는다. 구글 중계 주소는 원문 주소와 다르므로 제목 비교가 주 판정이다.
- 같은 기사가 키워드 여러 개에 걸리면 한 줄, `keywords`에 모은다. ③ 매체 글이 키워드에 걸리면 ②에도 한 줄(원문 주소라 요약 재료가 충분).

## 3. 매체 RSS 조사표

조사: 2026-11-01, 웹 세션 WebSearch·WebFetch(robots 준수 도구). robots.txt는 **한 곳도 원문을 보지 못했다**(도구가 검색에 안 나온 주소를 열지 않음 — 사이트가 거절한 것이 아님). 그래서 robots 칸은 모두 "확인 못 함"이고, **수집기가 실행 때 robots.txt를 직접 읽어 막혀 있으면 건너뛴다**(사회운동 Now와 같은 원칙, 우회하지 않음). 구현 PR에서 같은 User-Agent로 GET 한 번씩 확인해 이 표를 고친다.

### 3.1 국내

| 매체 | RSS 주소 | 피드 내용 | 유료 | 1단계 |
| --- | --- | --- | --- | --- |
| 매일노동뉴스 | `https://www.labortoday.co.kr/rss/allArticle.xml`(전체) [사실: RSS 안내 쪽]. 분야별 RSS 없음, 노동·사회는 목록 쪽만 [사실] | 확인 못 함(같은 기사관리 시스템은 요약 포함 [추정]) | 구독 메뉴 있음, 유료벽 안내 없음 [사실] | 넣음 |
| 참여와혁신 | RSS 안내 쪽 `laborplus.co.kr/rssIndex.html` [사실], 피드는 `/rss/allArticle.xml` [추정] | 확인 못 함 | '유료기사' 메뉴 있음 [사실] | 결정 N7 |
| 참세상 | 첫 화면에 피드 링크 없음 [사실], `newscham.net/feed/` [추정] | 확인 못 함 | 무료 [추정] | 구현 때 확인 |
| 비마이너 | `https://www.beminor.com/rss/allArticle.xml` [사실] | 앞부분 발췌(title·link·description·author·pubDate) [사실] | 후원제 [사실] | 넣음 |
| 노동과세계 | 첫 화면에 RSS 링크 없음 [사실]. `/rss/allArticle.xml` [추정], 없으면 목록 쪽 | — | 무료 [추정] | 구현 때 확인 |
| 미디어오늘 | `/rss/allArticle.xml` [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 한겨레 | `hani.co.kr/rss/society/` 꼴 [추정] | 확인 못 함 | 무료(후원) | 구현 때 확인 |
| 경향신문 | 국문 사회 `khan.co.kr/rss/rssdata/` 아래 [추정](영문판 `english_news.xml`은 [사실], 요약·utm 붙음) | 요약 [사실, 영문판] | 무료 | 구현 때 확인 |
| 오마이뉴스 | `rss.ohmynews.com/rss/society.xml` 꼴 [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 프레시안 | `https://www.pressian.com/rss`(하단 링크) [사실], 분야별 주소 확인 못 함 | 확인 못 함 | 무료(후원) [사실] | 넣음 |
| 민중의소리 | 확인 못 함 | — | 무료 | 피드 없으면 ②로만(결정 N8) |
| 연합뉴스 사회·경제 | `yna.co.kr/rss/society.xml`·`economy.xml` [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 철도·교통 전문지 | 철도경제신문·레일뉴스 모두 RSS 정보 없음(확인 못 함) | — | — | 피드 없으면 ②로만(결정 N8) |
| 정책브리핑 보도자료 | **RSS 서비스 중단 공지(2026-07-01)** [사실]. 보도자료 목록 `korea.kr/briefing/pressReleaseList.do` [사실]. 기획재정부는 부처 목록에 '재정경제부'로 바뀌어 있음 [사실] | — | 무료 | 목록 쪽 읽기(사회운동 Now의 `html` 방식), 부처 이름으로 거름(결정 N9) |
| 고용노동부(부처) | `moel.go.kr/rss/notice.do`·`policy.do`·`lawinfo.do` [사실]. **보도자료 RSS는 목록에 없음** [사실] | 확인 못 함 | 무료 | 입법·행정예고(`lawinfo`)만 추천 |
| 국토교통부(부처) | 확인 못 함 | — | 무료 | 정책브리핑 목록으로 대신 |

### 3.2 해외

| 매체 | RSS 주소 | 피드 내용 | 유료 | 1단계 |
| --- | --- | --- | --- | --- |
| PSI | `https://publicservices.international/feed.xml`(하단 링크) [사실] | 확인 못 함 | 무료 | 넣음 |
| ITF | `https://www.itfglobal.org/en/rss/feed`(하단 링크) [사실] | 확인 못 함(목록 쪽엔 발췌 [사실]) | 무료 | 넣음 |
| ILO | 2024년 사이트 개편 뒤 RSS 확인 못 함 | — | 무료 | 구현 때 확인, 없으면 뺌 |
| Equal Times | **2025-12 발행 중단** [사실] | — | — | 뺌 |
| LabourStart | `labourstart.org/rss/labourstart.xml`(세계), `/rdf/labourstart.asia.rss`(아시아) [사실], 공개 위젯용으로 안내 [사실] | 제목 중심 [추정] | 무료 | 넣음(아시아 기본) |
| The Guardian | 섹션 주소 + `/rss`, 예 `theguardian.com/society/rss` [사실, 제3자 안내]. 노조 주제 피드 `.../trade-unions/rss` 꼴 [추정] | 요약 [추정] | 무료 | 구현 때 주소 확인 |
| AP | 공식 RSS 없음 [추정, 제3자 안내] | — | — | 뺌(②에서 걸리면 들어옴) |
| Reuters | 공식 RSS 2020년 중단 [추정, 제3자 안내], 자동 읽기를 많이 막음 | — | 일부 유료 | 뺌 |
| 共同通信 | 확인 못 함 | — | — | 선택 — 뺌 추천 |
| NHK | `www3.nhk.or.jp/rss/news/cat1.xml`(사회)·`cat5.xml`(경제) 꼴 [추정], 노동 분야 따로 없음 [추정] | 확인 못 함 | 무료 | 선택 — 뺌 추천(노동만 거를 수 없음) |

### 3.3 구글 뉴스 검색 RSS (② 키워드)

| 항목 | 내용 |
| --- | --- |
| 주소 | `https://news.google.com/rss/search?q=<검색어>&hl=ko&gl=KR&ceid=KR:ko` [제3자 문서]. `q`에 `"구"`·`OR`·`-`·`when:1d` 사용 가능 [제3자 문서]. 키워드마다 `"키워드" when:1d`로 하루치만 |
| 결과 | 제목(끝에 ` - 매체`), 링크, 게시 시각, `<source>` 매체 이름 [제3자 문서] |
| 링크 | **구글 중계 주소**(`news.google.com/rss/articles/…`) — 원문 주소가 바로 안 나옴 [제3자 문서]. 원문을 얻으려면 구글 쪽을 더 불러 풀어야 하고 방식이 자주 바뀜 → **풀지 않는다**(우회 비슷한 일, 깨지기 쉬움). 화면 [원문]은 중계 주소 그대로 — 누르면 브라우저가 원문으로 넘어간다 |
| 이용 조건·robots | 공식 약관 원문·`/robots.txt`의 `/rss` 허용 여부 확인 못 함. 수집기가 실행 때 robots를 읽고 막혀 있으면 ②는 ③ 매체 피드 일치만으로 돈다 |
| 양 | 키워드 10개 × 하루 3번 = 하루 30번 요청(요청 사이 2초) |

## 4. AI 한도와 하루 예상 호출 수

| 칸 | 재료 | 부르는 방식 | 하루 호출(추정) | 1번 토큰(추정) |
| --- | --- | --- | --- | --- |
| ① 내 스크랩 | 원문 쪽 본문 앞 3,000자(재료로만, 저장 안 함) | 링크 1개에 1번 | 10~20번 | 입력 약 3,000 · 출력 약 600(생각 몫 포함) |
| ② 키워드 | 제목 + 매체 피드 설명(있으면) | 새 기사 10건 묶음에 1번, 하루 60건까지 요약(넘으면 제목만) | 3~6번 | 입력 약 3,000 · 출력 약 1,200 |
| ③ 매체 | — | AI 안 씀 | 0 | — |

- 단가(`_shared/ai-model.ts` 기본값 [사실]): 입력 100만 토큰 140원, 출력 700원.
- ①: 20 × (3,000×140 + 600×700)/1,000,000 ≈ 20 × 0.84 ≈ **17원/일**. ②: 6 × (3,000×140 + 1,200×700)/1,000,000 ≈ 6 × 1.26 ≈ **8원/일**. 합계 하루 약 26번·25원, **한 달 약 800원**(추정).
- 한도(제안): `news-feed` 전용 한 달 상한 **2,000원**(`collector-feed` 6,000원과 같은 방식), 사용량은 `app_news_days.ai_*`에 쌓고 홈 'AI 사용량' 줄(`drive-summary ?action=ai_usage`)에 한 줄 더한다. `ai-assist` 15,000원 한도와 기록 표(`app_ai_daily_usage`)는 건드리지 않는다 — service role이 그 표에 쓸 권한이 저장소 migration에 없다 [사실: 그 표 grant 정의가 저장소에 없음]. 상한에 닿으면 그 달은 요약 없이 제목만 넣는다.
- 요약 문구 규칙은 사회운동 Now와 같다: 본문 60자 미만이면 AI 안 부름, '요약할 수 없음'류 답은 비움(`AI_NO_MATERIAL_PATTERNS`), 한 줄 120자 안쪽, `AI_TONE_RULE`.
- 결정 N3에서 "② 요약 안 함"을 고르면 ②는 0번 → 하루 약 20번·한 달 약 520원.

## 5. 저작권·보관 경계

| 대상 | 서버에 보관 | 보관하지 않음 | 화면 |
| --- | --- | --- | --- |
| ① 내 스크랩 | 정리한 주소, 원문 페이지 메타의 제목·매체 이름·게시 시각, AI 한 줄 요약(120자), 스크랩 시각 | 기사 본문·발췌·사진·`og:description` 원문(AI 재료로 한 번 쓰고 버림) | 제목 + 한 줄 요약, [원문]은 기사 쪽 |
| ② 키워드 | 제목·매체·시각·주소(구글 중계 또는 원문)·걸린 키워드·AI 한 줄 요약 | 본문·설명 원문 | 같음 |
| ③ 매체 | 제목·매체·시각·주소 | 피드 설명·본문 | 제목만, [원문] |

- 근거: 기사 본문·사진은 저작물이다(추정: 사실만 전하는 짧은 보도는 보호가 약하지만 대부분 기사는 보호 대상). 제목·링크·직접 쓴 한 줄 요약은 개인 업무용 소개 범위로 본다(추정). 사회운동 Now 외국 매체 경계(본문·전문 번역 저장 안 함)와 같다.
- 유료 매체는 넣지 않는다. 유료벽 넘기·봇 확인 풀기·robots 무시는 하지 않는다(사회운동 Now의 공공운수노조 예외 같은 것은 이 기능에 두지 않음).
- 공개 경로(Web1·공유 링크·공개 저장소)로 다시 내보내는 길은 만들지 않는다.
- 로그·PR·보고에는 기사 제목·주소·키워드를 쓰지 않는다(건수·키·상태만). 시험 견본은 가짜 제목·`example.com` 주소로.

## 6. 화면 (시안: [mockups/news-clipping.html](mockups/news-clipping.html))

- 메뉴: `app/menu-model.mjs`에 `{id:'news', label:'뉴스 클리핑'}`를 `outside` 바로 다음에, `index.html` 두 메뉴·`topbar-actions.js` 화면 이름 두 표에 같이(사회운동 Now가 더해진 자리와 같음).
- 한 화면에 세 칸(PC 1440은 세 칸 나란히, 폰 412는 칸 이름 줄 [내 스크랩 · 키워드 · 매체] + 좌우 밀기):
  - ① 내 스크랩: 날짜 묶음 머리 → 줄마다 `매체 · 시각`(작게) / 제목 / 한 줄 요약 / [원문]. 대기 줄은 도메인 + '읽는 중'. robots 막힘은 도메인 + '사이트가 자동 읽기를 막아 둠'.
  - ② 키워드: 키워드 칩 줄(공용 `chip-rows.js`, 두 줄 + 더보기, 끝에 작은 [+]) — 칩을 누르면 그 키워드만. 줄마다 꼬리에 걸린 키워드 작은 꼬리표.
  - ③ 매체: 매체 칩 줄(국내·해외 묶음 + 낱개), 줄은 `매체 · 시각` / 제목뿐(요약 없음).
  - 오른쪽 위 ⋯: '키워드 고치기'(켬/끔·지우기·더하기), '매체 켜고 끄기'(마지막으로 읽은 시각·막힘 표시), 마지막 읽은 시각 한 줄.
- 글 한 줄 모양·크기는 사회운동 Now `os-post`와 같게(제목 14px · 요약 13px · 꼬리 12px, 큰 카드·굵은 버튼 없음, 톤다운 색, 기존 테마 토큰). 공용으로 빼야 하면 화면 PR에서 `os-post` 그리기를 작은 공용 모듈(예: `app/feed-row.js`)로 옮기고 두 화면이 함께 쓴다(복사 금지).
- 줄 왼쪽으로 밀기 = 지우기(`hidden_at`, 서버 저장) — 텔레그램 소식의 밀기와 같은 공용 동작이 있으면 그것을 쓴다.
- 업데이트 기록(`app/release-notes/…json`)은 화면 PR에서.

## 7. 구현 PR 순서 (줄 세우기)

| 순서 | PR | 내용 | 정지 |
| --- | --- | --- | --- |
| ① | 이 PR | 설계 문서 + 정적 시안 | — |
| ② | DB | `app_news_items`·`app_news_keywords`·`app_news_days` + 칸 grant(`collector-feed`용 대기 줄 칸, `news-feed`용) + 짝 파일 5개 + 실제 PostgreSQL 권한 시험 | ★DB 적용 정지★(승인형 workflow, 시험 적용 먼저) |
| ③ | Edge 공용 옮기기 | `outside-feed` 읽기·해석 코드 → `_shared/feed-fetch.ts`(동작 같음, 기존 시험 통과) + `outside-feed`가 `news-` 키를 건너뛰는 시험 | ★`outside-feed` 재배포 정지★(되돌리기 ref 기록) |
| ④ | Edge `news-feed` | 새 함수 + `_shared/news-catalog.ts`(1단계 매체만) + 열린 주소 규칙 시험 + `news-feed.yml` 예약 + 5절 표 한 줄 | ★Edge 첫 배포 정지★ + 명진 비밀값 `NEWS_FEED_CRON_SECRET` 등록(GitHub·Supabase 두 곳) |
| ⑤ | 스크랩 입구 | `collector-feed ?action=scrap` + 앱 스크립트 `tgScrap_run_` + 설치 안내(`TG_SCRAP_ROOMS`, 제외 목록) | ★`collector-feed` 재배포 정지★ + 명진이 스크립트 교체·속성 넣기 |
| ⑥ | 화면 1 | 메뉴 + ③ 매체 칸 + ② 키워드 칸 + 키워드·매체 고치기 + 업데이트 기록 | ④ 필요 |
| ⑦ | 화면 2 | ① 내 스크랩 칸(+ [지금 채우기], N4) | ⑤ 필요 |
| ⑧ | 나중 | 스크랩으로 키워드 클리핑 더 잘 찾기(8절) | 별도 설계 |

- ③은 `outside-feed`를 만지는 다른 PR(사회운동 Now 후속)과 앞뒤로 세운다. ⑤는 `collector-feed`·`docs/ops/collector-feed.gs`를 만지는 다른 PR과 앞뒤로.

## 8. 나중 (설계에만): 내 스크랩으로 더 잘 찾기

- 재료: 내 스크랩 줄의 제목·매체·한 줄 요약(본문 없음). 스크랩 줄은 지우지 않고 쌓는다(2.2 크기).
- 1단계 생각: 한 주에 한 번 AI가 최근 스크랩 제목들로 "새 키워드 후보 3~5개"를 뽑아 키워드 고치기 화면에 '추천'으로 보이고, 명진이 눌러야 더해진다(자동으로 더하지 않음).
- 2단계 생각: ② 키워드 기사마다 "스크랩한 기사와 얼마나 닮았나" 점수를 매겨 위로 올리기(제목 낱말 겹침 → 필요하면 의미 벡터). 의미 벡터는 사회운동 Now Q8과 같은 판단(확장 추가는 읽생기와 같은 DB라 따로).
- 스크랩한 기사와 같은 매체·같은 낱말이 자주 나오면 ③ 매체 칩 순서를 바꾸는 정도는 AI 없이도 된다.

## 9. 보안 확인

- 읽기만: GET만, 로그인·글쓰기·구독 신청 없음. 화면에 공유·퍼 나르기 버튼 없음([원문] 링크만).
- 외부 입력 → 외부 행동 자동 연결 없음: 텔레그램 링크는 읽기(GET)와 저장만 일으키고, 발송·공유·삭제로 이어지지 않는다.
- 서버가 읽는 주소: ②③은 카탈로그 허용 호스트만, ①은 열린 주소 규칙(2.3) — 화면은 주소를 보내지 않는다.
- 표는 소유자 RLS, 글 넣기는 service role만, `anon`·`PUBLIC` 없음. 화면이 쓰는 칸은 키워드·켬/끔·지우기뿐.
- 받은 HTML은 서버에서 글자만 뽑고, 화면은 글자로만 그린다.
- 기능 허용: ②③은 노조 사람 각자 자기 작업공간에서(사회운동 Now Q9와 같음). ①은 텔레그램 수집이 운영자 전용이라 운영자 작업공간에서만.

## 10. 명진 결정 질문 (일상어, 추천안 포함)

| 번호 | 질문 | 추천 |
| --- | --- | --- |
| N1 | 스크랩 방 링크를 지금 텔레그램 수집 길(회사 PC → Drive → 앱 스크립트)로 받을까요? 스크립트 한 번 바꿔 붙이고 설정 한 칸에 방 이름만 넣으면 됩니다 | 예(2.1 '나') |
| N2 | 스크랩 링크에 제목·요약이 붙는 건 하루 3번(아침·점심·저녁)이면 될까요? | 예. 급할 때 누르는 [지금 채우기]는 N4 |
| N3 | 키워드로 찾은 기사는 구글이 원문 주소를 숨겨서, 요약 재료가 제목뿐인 경우가 많아요. 그런 기사는 요약 없이 제목만 둘까요? | 예 — 매체 피드에서도 걸린 기사(설명 있음)만 요약, 나머지는 제목만 |
| N4 | 내 스크랩 칸에 [지금 채우기] 작은 단추를 둘까요?(하루 10번까지) | 둠 |
| N5 | 스크랩 방은 '텔레그램 소식' 요약에서는 빼도 될까요? | 뺌(같은 링크가 두 군데 나오지 않게) |
| N6 | 매체 새 글은 30일, 키워드 기사는 180일 지나면 지우고, 내 스크랩은 계속 둘까요? | 예 |
| N7 | 참여와혁신은 '유료기사' 메뉴가 있어요. 매체 칸은 제목만 보이니 넣을까요? | 넣음(제목·링크만, 유료 글 요약은 안 함) |
| N8 | 민중의소리·철도 전문지는 RSS를 못 찾았어요. 키워드 클리핑으로만 잡을까요?(예: 키워드 '철도' 매체 칸 대신) | 예 — 피드가 확인되면 그때 매체 칸에 |
| N9 | 정책브리핑은 RSS가 끊겨 보도자료 목록 쪽을 읽어야 해요. 기재부(지금 '재정경제부')·국토부·고용노동부 보도자료만 거를까요? | 예 |
| N10 | 해외 중 AP·Reuters·NHK·共同通信은 매체 칸에서 빼고 키워드에서 걸리면 보이게 할까요? Equal Times는 발행이 끝나 뺍니다 | 예 |

### 외국어 번역 (S47-57, 명진 11/01 23:57)

"백그라운드에서 미리 다 번역해 두지 말고 제목만 번역해 두고, 내가 클릭하면 본문은 그때 번역하면 되잖아."

- 제목: 수집 때(하루 3번 예약의 `titles` 단계, [지금 채우기] 뒤) 서버가 외국어 기사 제목만 한국어로 번역해 `title_ko`에 둔다. 작업공간마다 여러 제목을 AI 한 번에 묶고(`TITLE_BATCH`), 하루 `TITLES_DAILY`개·최근 `TITLE_WINDOW_DAYS`일 기사·이번 달 AI 한도 안에서만. 화면은 한국어 제목 + 원제 작게.
- 본문: 지금처럼 [번역]을 누를 때만 번역해 `body_ko`에 저장(저장본이 있으면 AI를 다시 부르지 않음). 제목 번역은 그대로 둔다.

## 11. 완료 기준 (요청 그대로)

뉴스 클리핑 메뉴에서 ① 텔레그램 스크랩 방에 올린 링크가 매체·제목·한 줄 요약과 함께 맨 위에, ② 키워드에 걸린 기사(스크랩과 겹치지 않게), ③ 켠 매체의 새 글 제목이 하루 3번 들어온다. 명진 실기기 확인.

## 12. 확인에 쓴 주소

labortoday.co.kr/rssIndex.html · laborplus.co.kr(하단 RSS 링크) · beminor.com/rss/allArticle.xml · worknworld.kctu.org · newscham.net · mediatoday.co.kr · pressian.com(하단 RSS 링크) · khan.co.kr/rss/rssdata/english_news.xml · moel.go.kr/site/rss/rssList.do · korea.kr/etc/ministry.do · korea.kr 공지(RSS 중단, 검색 결과) · publicservices.international · itfglobal.org/en/news · equaltimes.org · labourstart.org/lnwnews.shtml · feeder.co 안내(Guardian·AP·Reuters) · metawatch.iptc.org(NHK) · newscatcherapi.com·codewords.ai(구글 뉴스 RSS 검색 변수). 열지 못한 주소: 각 사이트 `/robots.txt`, news.google.com/robots.txt, pressian.com/rss, labortoday.co.kr/rss/allArticle.xml, itfglobal.org/en/rss/feed, publicservices.international/feed.xml.
