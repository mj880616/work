# 뉴스 클리핑 설계 (NEWS-클리핑, S47-39)

📱 폰 가능 — 이 문서는 설계·조사와 정적 시안만 담는다. 앱 코드·DB·Edge·워크플로·앱 스크립트 변경 없음. SQL 초안도 넣지 않는다(DB PR에서 짝 파일 5개로).

- 작성: 2026-11-01, Claude Code 웹(작업 세션 S47-39). 기준 main `55f9f54`.
- 요청: 명진 결정 11/01 21:14~21:21("ㅇㅇ"). 새 메뉴 '뉴스 클리핑' — 사회운동 Now(`app/outside-statements.js`, Edge `outside-feed`, [outside-statements.md](outside-statements.md))와 같은 틀(하루 3번 읽기, 출처 켜고 끄기, 제목 + 한 줄 요약, 누르면 원문, 같은 저작권 경계)을 다시 쓴다.
- 시안: [mockups/news-clipping.html](mockups/news-clipping.html)(폰 412 · PC 1440, 글은 모두 가짜).
- 표기: [사실] = 저장소 코드·migration 또는 웹에서 직접 확인, [추정] = 주소 모양·제3자 안내·짐작, "확인 못 함". 웹 세션이라 production·운영 DB·robots.txt 원문은 보지 못했다.
- 공개 저장소: 텔레그램 방 이름·번호, 실제 스크랩 내용, 개인정보는 이 문서·시안·코드에 쓰지 않는다. 방 지정은 앱 스크립트 속성에만 둔다.

## 0. 요약과 추천

1. **메뉴**(바뀜 2026-11-02 — 13절): ~~사회운동 Now 바로 아래에 '뉴스 클리핑' 한 칸~~ → 사회운동 Now와 합친 **'Now' 메뉴의 [뉴스] 탭**. 아래는 처음 설계(S47-39) 기록: 사회운동 Now 바로 아래(폰은 더보기 메뉴 같은 자리)에 '뉴스 클리핑' 한 칸. 화면 하나 = 모듈 하나(`app/news-clipping.js`)가 상태를 갖고 그린다(AGENTS §5). 칸은 ① 내 스크랩 ② 키워드 ③ 매체별 새 글, 폰은 좌우 밀기로 칸 이동.
2. **① 내 스크랩은 기존 텔레그램 수집 길을 그대로 탄다**: 회사 PC 수집기 → Drive → 앱 스크립트(매시) → Edge `collector-feed`. 앱 스크립트에 스크립트 속성 `TG_SCRAP_ROOMS`(스크랩 방 지정, 저장소에 값 없음) 하나와 작은 함수 하나를 더하고, `collector-feed`에 입구 `?action=scrap`(같은 비밀값)을 더한다. `collector-feed`는 **링크 검사·저장만** 하고 AI·바깥 읽기는 하지 않는다. 링크의 매체·제목·요약은 아래 새 수집기가 하루 3번 붙인다.
3. **수집기는 새 Edge 함수 `news-feed`** 하나(예약 입구 + 화면 입구, `verify_jwt=false` + 함수 코드 인증 — `outside-feed`와 같은 두 입구). 읽기·robots·크기 상한·RSS 해석·AI 부르기 코드는 **`outside-feed`의 것을 `_shared/`로 옮겨 함께 쓴다**(복사 금지). `outside-feed`를 넓히지 않는 까닭: 그 함수는 "카탈로그 허용 호스트만 읽는다"가 보안 경계인데, 스크랩은 아무 매체 주소나 오므로 경계가 다르다(3.2).
4. **저장**: 새 표 `app_news_items`(세 칸 글 한 표, `lane`으로 구분)·`app_news_keywords`(키워드)·`app_news_days`(하루 AI 사용량). 매체 켜고 끄기는 **기존 `app_outside_sources`를 다시 쓴다**(키 앞에 `news-`). 기사 본문은 저장하지 않는다(제목·매체·시각·주소·AI 한 줄 요약만).
5. **AI**: 내 스크랩(링크마다 1번)과 키워드 기사(10건 묶음에 1번)만. 매체 새 글은 제목만. 하루 약 26~30번·한 달 약 800원 추정, 이 기능 상한 한 달 5,000원(4절, 2026-11-10 명진 결정으로 2,000원에서 올림 — #2257).
6. **바뀜(2026-11-06, NEWS-전면개편 — [news-overhaul.md](news-overhaul.md))**: 4번 '기사 본문은 저장하지 않는다'는 명진 결정 D1(가)로 바뀜 — 수집 때 본문 문단·사진 주소·캡션을 소유자 비공개 저장(새 표 `app_feed_bodies`). 예약은 Supabase 예약으로(D3), 상세 요약·시사점은 수집 때 미리(D2). [뉴스] 탭 이름은 [언론].
7. **막힌 곳**: 정책브리핑 RSS는 2026-07-01 서비스 중단 공지 [사실] → 보도자료 목록 쪽 읽기로. Equal Times는 2025-12 발행 중단 [사실] → 뺌. AP·Reuters는 공식 RSS가 없음 [추정] → 매체 칸에 넣지 않음. 구글 뉴스 RSS의 링크는 구글 중계 주소라 원문 주소가 바로 나오지 않음 [제3자 문서] → 키워드 요약 재료가 모자람(결정 N3).

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

### 3.0 가져오는 순서 원칙 (11/04 명진 결정, NEWS-비마이너프레시안)

매체 한 곳마다 아래 순서로 가장 위에서 되는 방법만 쓴다. 한 단계 아래로 내려가는 이유와 날짜를 3.1·3.2 표 '1단계' 칸에 적는다.

1. **공식 RSS** — 매체가 안내하는 피드 주소. robots.txt는 수집기가 실행 때마다 읽고 막혀 있으면 건너뛴다(우회 없음).
2. **구글 뉴스 검색 RSS로 그 매체만** — `"키워드" site:매체` 꼴이 아니라 검색어에 매체 이름을 넣어 잡는다(3.3). 페이지 긁기는 하지 않는다.
3. **그 매체의 텔레그램 채널** — 명진이 구독하면 회사 PC 텔레그램 수집기가 Drive 수집 폴더에 모으고, 채널 기사 보내기(`tgScrap`, `docs/ops/collector-feed-setup.md`)가 주소만 Web2로 보낸다. 뉴스 채널만(단체방·개인방 제외).

- **텔레그램 채널을 더하는 법(명진 할 일 한 줄)**: 구독한 뒤 **채널 이름만 알려 준다** → CC가 구글 앱스 스크립트 속성 `TG_SCRAP_ROOMS`에 한 줄 더한다(채널 목록은 그 속성에만 있고 '구독하면 자동으로 전부'는 아니다 — 수집기가 모으는 방 가운데 어느 방이 뉴스 채널인지 서버가 알 수 없기 때문). 수집 폴더에 그 채널이 이미 생겼는지는 CC가 확인한다 [추정: 수집기가 구독 방을 폴더로 모음 — 설치 문서 기준, 실제 방 목록은 확인 못 함].
- **매체별 '다 받기/키워드만'**: 카탈로그 `take` 한 칸. 운동·노동 매체(매일노동뉴스·비마이너·프레시안)와 해외 노조 매체는 `all`(키워드 상관없이 전부), 종합지·방송사는 `keywords`(NEWS-매체늘리기).
- **시간대**: 한국어 매체 RSS의 시간대 없는 날짜(비마이너 `YYYY-MM-DD HH:MM:SS`)는 서울 시간으로 읽는다(`feedDate`).

### 3.1 국내

| 매체 | RSS 주소 | 피드 내용 | 유료 | 1단계 |
| --- | --- | --- | --- | --- |
| 매일노동뉴스 | `https://www.labortoday.co.kr/rss/allArticle.xml`(전체) [사실: RSS 안내 쪽]. 분야별 RSS 없음, 노동·사회는 목록 쪽만 [사실] | 확인 못 함(같은 기사관리 시스템은 요약 포함 [추정]) | 구독 메뉴 있음, 유료벽 안내 없음 [사실] | 넣음 |
| 참여와혁신 | RSS 안내 쪽 `laborplus.co.kr/rssIndex.html` [사실], 피드는 `/rss/allArticle.xml` [추정] | 확인 못 함 | '유료기사' 메뉴 있음 [사실] | 결정 N7 |
| 참세상 | 첫 화면에 피드 링크 없음 [사실], `newscham.net/feed/` [추정] | 확인 못 함 | 무료 [추정] | 구현 때 확인 |
| 비마이너 | `https://www.beminor.com/rss/allArticle.xml` [사실] | 앞부분 발췌(title·link·description·author·pubDate, pubDate는 시간대 없는 `YYYY-MM-DD HH:MM:SS` → 서울 시간으로 읽음) [사실] | 후원제 [사실] | 넣음 |
| 노동과세계 | 첫 화면에 RSS 링크 없음 [사실]. `/rss/allArticle.xml` [추정], 없으면 목록 쪽 | — | 무료 [추정] | 구현 때 확인 |
| 미디어오늘 | `/rss/allArticle.xml` [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 한겨레 | `hani.co.kr/rss/society/` 꼴 [추정] | 확인 못 함 | 무료(후원) | 구현 때 확인 |
| 경향신문 | 국문 사회 `khan.co.kr/rss/rssdata/` 아래 [추정](영문판 `english_news.xml`은 [사실], 요약·utm 붙음) | 요약 [사실, 영문판] | 무료 | 구현 때 확인 |
| 오마이뉴스 | `rss.ohmynews.com/rss/society.xml` 꼴 [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 프레시안 | ~~`https://www.pressian.com/rss`~~ 는 RSS 안내 HTML 쪽이라 0건 [사실, 11/04]. 실제 피드 `http://www.pressian.com/api/v3/site/rss/news` [사실, 요청함 확인], 카탈로그는 https만 허용이라 https로 적음 — 열리는지·robots는 CC가 배포 전 확인 [확인 못 함] | 확인 못 함 | 무료(후원) [사실] | 넣음 |
| 민중의소리 | 확인 못 함 | — | 무료 | 피드 없으면 ②로만(결정 N8) |
| 연합뉴스 사회·경제 | `yna.co.kr/rss/society.xml`·`economy.xml` [추정] | 확인 못 함 | 무료 | 구현 때 확인 |
| 철도·교통 전문지 | 철도경제신문·레일뉴스 모두 RSS 정보 없음(확인 못 함) | — | — | 피드 없으면 ②로만(결정 N8) |
| 정책브리핑 보도자료 | **RSS 서비스 중단 공지(2026-07-01)** [사실]. 보도자료 목록 `korea.kr/briefing/pressReleaseList.do` [사실]. 기획재정부는 부처 목록에 '재정경제부'로 바뀌어 있음 [사실] | — | 무료 | 목록 쪽 읽기(사회운동 Now의 `html` 방식), 부처 이름으로 거름(결정 N9) |
| 고용노동부(부처) | `moel.go.kr/rss/notice.do`·`policy.do`·`lawinfo.do` [사실]. **보도자료 RSS는 목록에 없음** [사실] | 확인 못 함 | 무료 | 입법·행정예고(`lawinfo`)만 추천 |
| 국토교통부(부처) | 확인 못 함 | — | 무료 | 정책브리핑 목록으로 대신 |


### 3.1b 종합지·방송사 늘리기 (11/04 요청함, NEWS-매체늘리기 → 11/08 S53-6에서 3곳, S54-02 2차에서 3곳, S54-03 3차에서 7곳 더 넣음)

**확인 방법(11/08, S53-6 웹 세션)**: WebSearch로 매체의 공식 'RSS 안내' 쪽을 찾아 WebFetch로 열었다. 이 세션 도구는 검색 결과에 나온 주소만 열 수 있어서 **피드 주소 자체(XML)는 하나도 직접 열지 못했다**(경향 영문 피드만 검색 결과에 나와 열림). 그래서 '넣음'은 **공식 안내 쪽에 [사실]로 적힌 피드 주소**만이고, 피드가 실제로 열리는지·robots는 배포 뒤 news-feed `probe`(저장 안 함)로 CC가 확인한다(안 열리면 그 매체 줄 한 줄을 빼는 작은 PR). 검색 도구가 "사이트가 허락하지 않음"으로 아예 거절한 매체는 안내 쪽을 볼 수 없었다(도구 거절 = 사이트 robots 판단으로 보이나 우리 수집기 기준과 같은지는 [추정]). 제3자 모음(블로그·gist·feeder.co 등)의 옛 주소는 쓰지 않았다(추측·우회 금지).

| 매체 | 분류 | 공식 RSS 안내 쪽 | 넣은 피드(사회·경제·정치) | 이용 조건(안내 쪽 원문 요약) | 결과 |
| --- | --- | --- | --- | --- | --- |
| 경향신문 | 종합지 | `khan.co.kr/help/help_rss.html` [사실] | `/rss/rssdata/society_news.xml`·`economy_news.xml`·`politic_news.xml` [사실: 안내 쪽]. 같은 경로 영문 피드는 RSS 2.0·`dc:date`·요약 description으로 열림 [사실] | 개인 구독 목적, 다수와 공유·영리는 허락 필요 [사실] | **넣음**(키워드만·기본 켬) |
| 오마이뉴스 | 인터넷 매체 | `m.ohmynews.com/NWS_Web/Help/srv/h_help_rss.aspx` [사실] | `rss.ohmynews.com/rss/society.xml`·`economy.xml`·`politics.xml` [사실: 안내 쪽] | 개인적 이용에 한정, 재배포·재RSS 금지 [사실] | **넣음**(키워드만·기본 켬) |
| 한국경제 | 경제지 | `hankyung.com/feed` [사실] | `/feed/society`·`/feed/economy`·`/feed/politics` [사실: 안내 쪽] | 안내 쪽에 RSS 조건 문구 없음(약관 링크만) [사실] | **넣음**(키워드만·기본 켬) |
| 노컷뉴스 | 인터넷 매체 | `nocutnews.co.kr/rss/` [사실] | `rss.nocutnews.co.kr/category/society.xml` 등 [사실: 안내 쪽] | 개인 비상업적 사용만, **'AI 학습 및 활용 금지'** [사실] | 1차엔 안 넣음 → **3차에서 넣음**(아래 3차 표) |
| SBS | 방송사 | `news.sbs.co.kr/news/rss.do` [사실] | `SectionRssFeed.do?sectionId=01`(정치)·`02`(경제)·`03`(사회) [사실: 안내 쪽] | 개인 비상업적 사용만, **'AI학습 이용 금지'** [사실] | 1차엔 안 넣음 → **3차에서 넣음** |
| MBC | 방송사 | `imnews.imbc.com/rss/index.html`(검색 결과) | — | 안내 쪽·피드 모두 **robots가 막음**(도구가 robots_disallowed로 거절) [사실] | 안 넣음 → 구글 뉴스 검색(3.3)으로만 |
| Guardian(노조 피드) | 해외 | 확인 못 함 — 검색 도구가 사이트 검색 거절 [사실: 도구 응답] | — | 확인 못 함 | 안 넣음 |

| 한겨레·조선·중앙·동아·매일경제·연합뉴스·JTBC·KBS·한국일보·서울신문·민중의소리·시사인·뉴스타파 | — | 1차(S53-6)에는 확인 못 함(검색 도구 거절·안내 쪽 없음) → **아래 2차 표에서 다시 확인** | — | — | 2차 표 참고 |

**2차 확인(11/08 19:35~19:50, S54-02)**: CC가 명진 크롬으로 매체 홈·안내 쪽·피드를 직접 열어 봤다 [사실]. 1차와 같은 규칙(공식 안내 쪽이나 홈의 공식 링크에 있는 주소만, 제3자 모음 주소 금지)에, 안내 쪽·피드·사이트 하단에 **AI 금지 문구가 없는 곳만** 넣는다는 기준을 더했다. 기사 링크 호스트는 피드 실물을 코드로 열어 보지 못해 [추정]이며 배포 뒤 probe로 확인한다.

| 매체 | 확인한 곳 | 피드 | 이용 조건·AI 문구 | 결과 |
| --- | --- | --- | --- | --- |
| 매일경제 | 공식 안내 쪽 `www.mk.co.kr/rss` [사실] | 사회 `/rss/50400012/`·경제 `/rss/30100041/`·정치 `/rss/30200030/`. 사회 피드 열림(application/xml·item 50·description 있음, copyright 'Copyright 2026 MK') [사실] | 안내 쪽·피드에 AI 금지 문구 없음 [사실] | **넣음**(`news-mk`, 키워드만·기본 켬) |
| 시사IN | 홈 머리의 공식 RSS 링크(`cdn.sisain.co.kr/rss/…`) [사실] | 전체 `cdn.sisain.co.kr/rss/gns_allArticle.xml` 열림(item 50·description 있음) [사실] | AI 문구 없음 [사실] | **넣음**(`news-sisain`, 키워드만·기본 켬) |
| 뉴스타파 | 홈의 공식 링크 `/rss` [사실] | `newstapa.org/rss` 열림(text/xml·item 20·description 있음) [사실] | AI 문구 없음 [사실] | **넣음**(`news-newstapa`, 키워드만·기본 켬) |
| 한겨레 | 피드 `www.hani.co.kr/rss/` [사실] | — | 피드 copyright에 **'무단 전재, 재배포, AI 학습 및 활용 금지'** [사실] | 2차엔 안 넣음 → **3차에서 넣음**(`news-hani`) |
| 연합뉴스 | 안내 쪽 `www.yna.co.kr/rss/index`(비상업 개인 용도만) [사실] | — | 피드 copyright **'AI 학습 및 활용 금지'** [사실] | 2차엔 안 넣음 → **3차에서 넣음**(`news-yna`) |
| 동아일보 | 안내 쪽 `rss.donga.com`(개인 비상업만) [사실] | — | 하단 **'AI학습 이용 금지'** [사실] | 2차엔 안 넣음 → **3차에서 넣음**(`news-donga`) |
| JTBC | 사이트 하단 [사실] | — | **'AI 학습 등을 금합니다'** [사실] | 2차엔 안 넣음 → **3차에서 넣음**(`news-jtbc`) |
| KBS | 사이트 하단 [사실], RSS 링크는 못 찾음 | — | **'이용(AI 학습 포함) 금지'** [사실] | 안 넣음 — RSS 링크를 못 찾음(3차도 같음) → 구글 뉴스 |
| 조선일보 | 홈에 RSS 안내·링크 없음 [사실]. 사이트 자체 주소의 피드는 열림(AI 문구 없음, 소개 거의 없음) [사실] | — | 공식 안내 쪽 없음 | 2차엔 안 넣음 → **3차에서 넣음**(`news-chosun`, 공식 안내 쪽 없음·사이트 자체 주소·명진 결정) |
| 중앙일보·한국일보·민중의소리 | 홈에 RSS 링크 없음 [사실] | — | — | 안 넣음 → 구글 뉴스(3.3) |
| 서울신문 | `/rss`가 403 [사실] | — | — | 안 넣음 → 구글 뉴스 |

- **양 조절(11/09부터 바뀜 → 3.1d)**: 넣은 곳(1차 3곳·2차 3곳·3차 7곳 모두)은 처음엔 `take: "keywords"` — 사회·경제·정치 섹션 피드만 읽고, 제목+소개에 **내 키워드가 글자 그대로 든 글만** 저장한다(AI 없이, `matchedKeywords`). 키워드가 하나도 없는 작업공간은 이 매체 글을 받지 않는다. 운동·노동 매체는 `all`.
- **본문**: 넣은 곳(1·2·3차 모두)은 `extract: false` — 수집 때 글 쪽을 읽지 않고 피드의 제목·소개·주소만 둔다(5절 ③ 매체 경계). 사람이 [본문]을 누를 때 열기는 다른 매체와 같다.
- **명진 결정(11/08 19:46)**: "AI 문구 매체도 넣어. 그런데도 다 수집해, 어차피 개인 용도잖아." → 11/08 명진: AI 문구 매체도 개인 용도로 넣음. 이용 조건에 'AI 학습·활용 금지'가 있는 매체(노컷·SBS·한겨레·연합뉴스·동아일보·JTBC)와 공식 안내 쪽은 없지만 사이트 자체 주소 피드가 열리는 조선일보를 3차에서 넣었다. 공개로 다시 내보내는 길은 없다(개인 작업공간 안에서만 봄). KBS는 RSS 링크를 못 찾아 넣지 않는다.

**3차 확인(11/08 19:50, S54-03)**: CC가 명진 크롬에서 피드를 직접 받아 봤다 — 모두 HTTP 200, item·description 있음 [사실]. 기사 링크 호스트는 피드의 `<link>` 기준이며, 연합뉴스·SBS는 이 세션에서 피드를 열지 못해 [추정]이다(배포 뒤 probe로 확인). 피드 주소의 쿼리(`?sectionId`·`?outputType`)는 수집기 주소 검사(`allowedUrl`: https·호스트·포트·계정만 봄)를 그대로 통과한다 — 규칙을 넓히지 않았다.

| 매체(key) | 피드(사회·경제·정치) | item 수 | 기사 호스트 | 확인한 곳·조건 | 결과 |
| --- | --- | --- | --- | --- | --- |
| 한겨레(`news-hani`) | `www.hani.co.kr/rss/society/`·`/economy/`·`/politics/` | 각 30 | `www.hani.co.kr` | 피드 copyright 'AI 학습 및 활용 금지' | **넣음**(키워드만·기본 켬) |
| 연합뉴스(`news-yna`) | `www.yna.co.kr/rss/society.xml`·`economy.xml`·`politics.xml` | 각 120 | `www.yna.co.kr` [추정] | 안내 쪽 `yna.co.kr/rss/index`(비상업·개인), 'AI 학습 및 활용 금지' | **넣음** |
| 동아일보(`news-donga`) | `rss.donga.com/national.xml`·`economy.xml`·`politics.xml` | 각 50 | `www.donga.com` | 안내 쪽 `rss.donga.com`(개인 비상업), 'AI학습 이용 금지' | **넣음** |
| JTBC(`news-jtbc`) | `news-ex.jtbc.co.kr/v1/get/rss/section/society`·`economy`·`politics` | 11·4·14 | `news.jtbc.co.kr` | 안내 쪽 `news.jtbc.co.kr/rss`, 'AI 학습 등 금함' | **넣음** |
| SBS(`news-sbs`) | `news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03`(사회)·`02`(경제)·`01`(정치) `&plink=RSSREADER` | 각 29 | `news.sbs.co.kr` [추정] | 안내 쪽 `news.sbs.co.kr/news/rss.do`, 'AI학습 이용 금지' | **넣음** |
| 노컷뉴스(`news-nocut`) | `rss.nocutnews.co.kr/category/society.xml`·`economy.xml`·`politics.xml` | 각 50 | `www.nocutnews.co.kr` | 안내 쪽 `nocutnews.co.kr/rss/`, 'AI 학습 및 활용 금지' | **넣음** |
| 조선일보(`news-chosun`) | `www.chosun.com/arc/outboundfeeds/rss/category/national/?outputType=xml`·`/economy/`·`/politics/` | 각 100 | `www.chosun.com` | 공식 안내 쪽 없음, 사이트 자체 주소, AI 문구 없음 | **넣음**(명진 결정) |
| KBS | — | — | — | RSS 링크 못 찾음 | 안 넣음 → 구글 뉴스 |
| 중앙일보·한국일보·민중의소리·서울신문 | — | — | — | RSS 없음 | 안 넣음 → 구글 뉴스 |
- 고른 '등등' 후보(11/04): 연합뉴스 · 한국일보 · 한국경제 · 매일경제 · 서울신문 · 노컷뉴스. 성향 표시는 균형 확인용이며 화면에는 쓰지 않는다.

### 3.1d 켠 언론사는 다 받기 (11/09, NEWS-다받기 · NEWS-새매체글없음)

- **명진 결정(11/09 14:20 A, 14:22 B+추가)**: "기사 일단 많이 들여와 … 구독한 언론사들은 최대한 들여오고". → 3.1b의 국내 13곳을 `take: "all"`로 바꿨다(키워드와 상관없이 섹션 피드 글을 모두 저장). `matchedKeywords` 길은 줄일 방안을 찾을 때 다시 쓰도록 남긴다.
- **피드 하나 통째로**: 매체 단계가 피드 하나에서 받는 글 수를 30 → `MEDIA_LIST_LIMIT` 150으로. 근거: 피드는 그 피드가 싣는 최근 글 수까지만 준다(연합 섹션 120·조선 100·매경·동아·노컷 50 등, 3차 표 [사실]). 수집은 08:22·13:22·18:22(서울) 하루 3번이라 밤 사이 14시간 동안 30건 넘게 나온 섹션은 30에서 끊으면 뒤쪽을 놓친다. 가장 큰 피드(120)보다 넉넉히 둔다. 피드가 싣는 수보다 더 많이 나온 섹션(연합 사회 등, 14시간 사이 120건 넘으면)은 여전히 놓칠 수 있다 — 막으려면 매체 단계를 더 자주 돌려야 하는데 그것은 DB 예약(pg_cron) 변경이라 제안만(범위 밖).
- **AI·본문 비용**: 이 13곳은 `extract: false`라 수집 때 글 쪽을 읽지 않고(MEDIA_BODY_PER_RUN·PENDING_PER_RUN·RUN_BUDGET_MS는 이 매체들에 쓰이지 않음), 국내 글이라 제목 번역(lang≠ko만)도 없다. 그래서 다 받아도 **AI 월 한도는 수집 때 늘지 않는다** — 사람이 상세에서 [요약]·[번역]·[본문]을 누를 때만 쓴다.
- **정리·저장량 [추정]**: 13곳을 다 받으면 하루 약 2,000줄(섹션마다 하루 발행 수 추정 합). 매체 새 글은 30일 뒤 정리(`app_news_prune`, 한 번 2,000줄 × 하루 3번 = 6,000줄)라 들어오는 양보다 정리 상한이 크다. 30일 쌓이면 약 6만 줄(제목·소개·짧은 앞부분, 한 줄 1~1.5KB 안팎 → 약 100MB [추정]). 줄일 방안(섹션 줄이기·보관 기간 줄이기·키워드로 다시 거르기)은 명진이 받아 본 뒤 정한다.
- **AI 한도 알림**: 이번 달 AI 한도(`MONTHLY_LIMIT_KRW`)에 닿으면 수집 때 요약·외국어 제목 번역이 조용히 멈췄다(화면은 버튼을 누를 때만 '이번 달 AI 한도에 닿음'). 이제 catalog 응답에 `ai.month_capped`(예/아니오만, 금액 없음)를 싣고 [언론] 목록 위 한 줄(`nc-when`)로 알린다.
- **'전체 0건' 진단(11/09)**: 13곳 모두 '성공'인데 글 0건이었다. 코드상 '성공'은 피드를 받았다는 뜻일 뿐, (가) 키워드가 제목·소개에 글자 그대로 든 글이 없었거나 (나) 피드 글 링크가 http이거나 허용 호스트 밖이라 모두 빠졌어도 같은 '성공·0건'으로 적힌다. 합성 시험으로는 키워드 거르기 코드가 맞게 동작함을 확인했고 [사실], 어느 쪽이었는지는 이 세션에서 피드를 열지 못해 [추정 불가]. 그래서 매체 단계 응답·로그에 `raw`(피드의 글 칸 수)·`listed`(주소·제목 검사를 통과한 수)를 더했다 — `raw>0, listed=0`이면 (나).
- **노컷뉴스 `robots_unreachable`**: 피드 호스트 `rss.nocutnews.co.kr`의 robots.txt를 읽지 못함(5xx·연결 실패·시간 초과·허용 밖 주소로 넘김 중 하나). 기록 코드는 그대로 두고 까닭 코드만 로그(`robots_unreachable` + `why`)에 남긴다. robots를 건너뛰지 않는다.

### 3.1e 새 언론사 후보 (11/09, NEWS-다받기 ③ — 확인 필요, 아직 안 넣음)

- **왜 안 넣었나**: S55-06 세션은 네트워크가 막혀(프록시가 매체 호스트 연결 거절) 사이트·robots·RSS를 열지 못했고, 검색으로도 공식 'RSS 안내' 쪽이 나오지 않았다 [사실]. 카탈로그는 공식 안내 쪽·홈의 공식 링크에서 [사실]로 확인한 주소만 넣는다(이 파일 3.1b 규칙). 그래서 아래는 **확인할 곳 목록**이고, 피드 경로는 같은 CMS를 쓰는 다른 매체(매일노동뉴스·비마이너·시사IN의 `/rss/allArticle.xml`) 모양에서 짐작한 [추정]이다.
- **확인 방법(3.1b 2·3차와 같음)**: 명진 크롬에서 ① 매체 홈 아래쪽·머리의 RSS 링크 또는 안내 쪽 ② 그 피드가 열리는지(item·description·기사 링크 호스트·https) ③ `robots.txt`에 막힘이 없는지 ④ 이용 조건 문구. 열리면 `take: "all"`·`on: true`·`extract: false`(노동·운동 매체는 매일노동뉴스처럼 본문 칸 규칙을 붙일지 따로)로 한 줄씩 넣는 작은 PR. 안 열리면 까닭과 함께 구글 뉴스(3.3)로.

| 분류 | 매체 | 홈 | 볼 피드 [추정] |
| --- | --- | --- | --- |
| 노동·운동 | 참여와혁신 | `www.labor21.com` | `/rss/allArticle.xml` |
| 노동·운동 | 노동과세계(민주노총) | `worknworld.kctu.org` | `/rss/allArticle.xml` |
| 노동·운동 | 레디앙 | `www.redian.org` | 홈의 RSS 링크(`/feed` 등) |
| 노동·운동 | 뉴스민 | `www.newsmin.co.kr` | 홈의 RSS 링크 |
| 노동·운동 | 미디어오늘 | `www.mediatoday.co.kr` | `/rss/allArticle.xml` |
| 통신사 | 뉴시스 | `www.newsis.com` | RSS 안내 쪽 |
| 통신사 | 뉴스1 | `www.news1.kr` | RSS 안내 쪽 |
| 경제·정책 | 이데일리 | `www.edaily.co.kr` | RSS 안내 쪽 |
| 경제·정책 | 머니투데이 | `www.mt.co.kr` | RSS 안내 쪽 |
| 경제·정책 | 서울경제 | `www.sedaily.com` | RSS 안내 쪽 |
| 철도·교통 | 철도·교통 전문지(이름은 확인 때 고름) | — | 홈의 RSS 링크 |
| 지역 | 경기일보·경인일보 | `www.kyeonggi.com`·`www.kyeongin.com` | `/rss/allArticle.xml` |
| 지역 | 부산일보·국제신문 | `www.busan.com`·`www.kookje.co.kr` | RSS 안내 쪽 |
| 지역 | 매일신문(대구)·영남일보 | `www.imaeil.com`·`www.yeongnam.com` | RSS 안내 쪽 |

### 3.1f 새 언론사 확인 결과 (11/10, S56-54 — NEWS-다받기-새언론사)

- **확인 방법**: 3.1b와 같은 규칙(매체 공식 'RSS 안내' 쪽이나 홈의 공식 링크에 [사실]로 나온 피드 주소만, 제3자 모음 주소 금지). 이 웹 세션은 셸에서 매체 호스트로 연결이 막혀(프록시 거절) WebSearch(사이트 한정 검색)로 나온 안내 쪽을 WebFetch로 열었다. 검색 결과에 없던 피드 주소는 도구가 열지 못한 경우가 많다. robots.txt는 이 도구로 열지 못했다 — 수집기가 실행 때마다 읽고 막혀 있으면 건너뛴다(우회 없음). 넣은 곳은 `take: "all"`·`on: true`·`extract: false`(1~3차와 같음).
- AI 금지 문구가 있는 곳(서울경제)도 11/08 명진 결정(개인 용도)과 같은 기준으로 넣었다.

| 분류 | 매체(key) | 확인한 곳 | 피드 | 이용 조건 | 결과 |
| --- | --- | --- | --- | --- | --- |
| 노동·운동 | 미디어오늘(`news-mediatoday`) | 안내 쪽 `www.mediatoday.co.kr/rssIndex.html` [사실] | 전체 `/rss/allArticle.xml` [사실: 안내 쪽]. 피드 실물은 열지 못함 | 안내 쪽에 RSS 조건 문구 없음 [사실] | **넣음** — 배포 뒤 probe로 raw·listed 확인 |
| 통신사 | 뉴시스(`news-newsis`) | 안내 쪽 `www.newsis.com/RSS/` [사실] | 사회·경제·정치 `/RSS/society.xml` 등 [사실]. 사회 피드 열림(RSS 2.0·description 있음·기사 링크 `https://www.newsis.com/view/…`) [사실] | 하단 '무단 전재·복사·배포 금지', 피드 안 저작권 고지 [사실] | **넣음** |
| 경제·정책 | 서울경제(`news-sedaily`) | 안내 쪽 `www.sedaily.com/rss` [사실] | 사회·경제·정치 `/rss/society` 등 [사실]. 사회 피드 열림(item 50·description 없음·기사 링크 `https://www.sedaily.com/article/…`) [사실] | '개인 이용자의 비상업적 사용에만', **AI 학습 금지** [사실] | **넣음**(명진 11/08 기준) |
| 지역(대구) | 매일신문(`news-imaeil`) | 안내 쪽 `www.imaeil.com/rss_service` [사실] | 사회·경제·정치 `/rss?cate=society` 등 [사실: 안내 쪽]. 피드 실물은 열지 못함 | 조건 문구 없음(저작권 표기만) [사실] | **넣음** — 배포 뒤 probe 확인 |
| 노동·운동 | 참여와혁신 | 홈 하단 RSS 링크 `www.laborplus.co.kr/rssIndex.html` [사실](요청함의 `labor21.com`이 아니라 `laborplus.co.kr`) | 안내 쪽을 이 도구로 못 염 → 피드 주소 [추정](`/rss/allArticle.xml`) | '유료기사' 메뉴 있음(3.1 표) | **안 넣음(확인 못 함)** — CC가 크롬으로 안내 쪽 피드 주소만 보면 한 줄 PR로 넣을 수 있음 |
| 노동·운동 | 노동과세계(민주노총) | 기사 쪽 `https://worknworld.kctu.org/…`가 **http로 넘김(302)** [사실] | — | — | **안 넣음** — 사이트가 https를 안 씀. 수집기는 https만 허용(보안 시험) → 구글 뉴스 |
| 노동·운동 | 레디앙 | 기사 쪽 머리·하단에 RSS 링크 없음 [사실] | — | 하단 '무단전재 및 재배포 금지' [사실] | **안 넣음** — 공식 RSS 링크 못 찾음 → 구글 뉴스 |
| 노동·운동 | 뉴스민 | 기사 쪽이 쿠키 확인 후 넘기는 빈 쪽(봇 확인) [사실] | — | — | **안 넣음** — 자동 읽기 막힘(풀지 않음) → 구글 뉴스 |
| 통신사 | 뉴스1 | 사이트 한정 검색 결과 없음 | — | — | **안 넣음(확인 못 함)** → 구글 뉴스 |
| 경제·정책 | 이데일리·머니투데이 | 사이트 한정 검색에 RSS 안내 쪽 안 나옴 | — | — | **안 넣음(확인 못 함)** → 구글 뉴스 |
| 철도·교통 | 철도경제신문(`redaily.co.kr`) | 기사 쪽에 RSS 링크 없음 [사실], '프리미엄' 유료 기사 있음 [사실] | — | 하단 '무단전재 및 재배포 금지' [사실] | **안 넣음** — 공식 RSS 링크 없음 → 키워드 '철도'(결정 N8) |
| 지역 | 부산일보 | 기사 쪽에 RSS 링크 없음 [사실] | — | '디지털 뉴스콘텐츠 이용규칙' 링크 | **안 넣음** → 구글 뉴스 |
| 지역 | 경인일보 | 홈에 RSS 링크 없음 [사실] | — | 하단 '무단 전재, 복사, 배포 금지' [사실] | **안 넣음** → 구글 뉴스 |
| 지역 | 국제신문·경기일보·영남일보 | 검색에 RSS 안내 쪽 안 나옴(국제신문은 http 주소 위주) | — | — | **안 넣음(확인 못 함)** → 구글 뉴스 |

- **수집 상한(②) 근거**: 새 4곳은 `extract: false`라 `MEDIA_BODY_PER_RUN`(30)·`RUN_BUDGET_MS`(100초)의 본문 읽기에 쓰이지 않고, `PENDING_PER_RUN`(60)은 채널 기사 대기 줄용이라 매체 수와 상관없다 [사실: handler.ts]. 매체 단계는 매체 하나에 한 번씩 따로 불리고(`run_plan`이 켠 매체 목록을 줌), 한 번에 피드 최대 3개 × 요청 사이 2초라 100초 예산 안이다. 피드 하나에서 `MEDIA_LIST_LIMIT` 150건까지(뉴시스·서울경제 사회 피드는 각 50~60여 건 [사실]). DB 예약 tick은 1분에 news 일 하나씩 꺼내므로(20261106070000 tick 코드 [사실]) 하루 3번 전체 수집의 일 수가 켠 매체 약 19 → 23곳 + 단계 4개로 늘어 약 28분 걸린다 — 다음 매시 '채우기' 전에 끝난다(2시간 넘으면 '늦음'). **조정 필요 없음.**
- **AI 한도(④)**: 월 5,000원(2026-11-10 명진 결정으로 2,000원에서 올림, `_shared/news-days.ts` `MONTHLY_LIMIT_KRW` — #2257). 한도에 닿으면 catalog 응답 `ai.month_capped` → [언론] 목록 위 한 줄(`AI_CAP_NOTE`)로 알린다 [사실: `app/news-clipping.js`·e2e `news-clipping.spec.mjs`]. 새 4곳은 국내·extract:false라 수집 때 AI를 쓰지 않는다.

**PSI·ITF 읽기(11/10 확인)**: 둘 다 사이트 하단·'Follow us'의 공식 피드 주소가 카탈로그와 같다(PSI `publicservices.international/feed.xml`, ITF `www.itfglobal.org/en/rss/feed`) [사실] — 주소는 안 바뀜. PSI 첫 화면 최신 글은 뉴스 11/05·11/02, 발간물 11/09·11/10 [사실], ITF 뉴스 목록 최신은 11/02, 그 앞 10/30·10/28 [사실]. 원래 글이 며칠에 한 번꼴이라 '3일 0건'은 정상 범위 [추정: 피드 실물은 이 도구로 못 열어 발간물이 피드에 드는지는 확인 못 함]. 고칠 것 없음. 배포 뒤 probe의 `raw`가 0이면 읽기 실패로 다시 본다.

### 3.1c 매체 고르기·같은 사건 묶기 — 남은 구현 (이 PR에 안 들어감)

- ⋯ 메뉴 이름을 '매체 켜고 끄기' → **'매체 고르기'**로 바꿨다(이 PR). 켜기·끄기는 이미 서버(`app_outside_sources`)에 저장되고 창에 마지막 읽은 시각·'읽지 못함'이 보인다.
- **기본 켬(S53-6에서 정함)**: 카탈로그 `on: true` 매체는 그 작업공간에 매체 줄이 없으면 켠 것으로 본다(서버 news-feed·화면 매체 고르기 같은 규칙). 적용 대상은 뉴스를 쓰는 작업공간(키워드가 있거나 news- 매체 줄이 하나라도 있는 곳)뿐이고, 처음 읽을 때 서버가 켬 줄을 만들어 읽은 시각·실패를 남긴다(이미 있는 줄은 덮지 않음 — 끈 줄은 꺼진 채). 끄면 `enabled=false` 줄이 남는다. 앞서 있던 6곳은 기본 켬이 아니다(지금처럼 켠 것만).
- **한 사건 한 묶음('외 3곳')**: 아직 안 만들었다. `title_key`(제목 정리값)가 같은 글은 이미 한 줄로 합치지만, 매체마다 제목이 다른 같은 사건은 못 묶는다. 제안: 제목 낱말 겹침 비율로 같은 날 묶기(화면 계산, 서버 변경 없음) — 시안을 먼저 눈으로 본 뒤 정한다(화면 결정).
- 이틀 넘게 읽기 실패 → CC 알림: 서버 `last_error`가 이틀 이상 유지되는 매체를 CC 예약 점검이 읽기 SQL로 확인하는 방식으로 하는 것이 가장 작은 변경(앱 코드 변경 없음). 점검 SQL은 PR ② 본문의 `app_outside_sources` 조회에 `last_ok_at < now() - interval '2 days'` 조건을 더하면 된다.

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

- **바뀜(2026-11-06, D2)**: 수집 때 요약·시사점 미리 만들기가 더해진다(기능 전용 한 달 상한 제안 1만 원, 명진 확인 M1). 사용량은 새 표 `app_feed_ai_days`, 홈 'AI 사용량'이 빠져 있던 `app_news_days`도 함께 더함 — news-overhaul.md 5절.

| 칸 | 재료 | 부르는 방식 | 하루 호출(추정) | 1번 토큰(추정) |
| --- | --- | --- | --- | --- |
| ① 내 스크랩 | 원문 쪽 본문 앞 3,000자(재료로만, 저장 안 함) | 링크 1개에 1번 | 10~20번 | 입력 약 3,000 · 출력 약 600(생각 몫 포함) |
| ② 키워드 | 제목 + 매체 피드 설명(있으면) | 새 기사 10건 묶음에 1번, 하루 60건까지 요약(넘으면 제목만) | 3~6번 | 입력 약 3,000 · 출력 약 1,200 |
| ③ 매체 | — | AI 안 씀 | 0 | — |
| ③' 종합지·방송사(keywords) | 글자 일치만(AI 없음) | 없음 | 0 | — |

- 단가(`_shared/ai-model.ts` 기본값 [사실]): 입력 100만 토큰 140원, 출력 700원.
- ①: 20 × (3,000×140 + 600×700)/1,000,000 ≈ 20 × 0.84 ≈ **17원/일**. ②: 6 × (3,000×140 + 1,200×700)/1,000,000 ≈ 6 × 1.26 ≈ **8원/일**. 합계 하루 약 26번·25원, **한 달 약 800원**(추정).
- 한도(제안): `news-feed` 전용 한 달 상한 **2,000원**(처음 제안. 2026-11-10 명진 결정으로 5,000원, #2257)(`collector-feed` 6,000원과 같은 방식), 사용량은 `app_news_days.ai_*`에 쌓고 홈 'AI 사용량' 줄(`drive-summary ?action=ai_usage`)에 한 줄 더한다. `ai-assist` 15,000원 한도와 기록 표(`app_ai_daily_usage`)는 건드리지 않는다 — service role이 그 표에 쓸 권한이 저장소 migration에 없다 [사실: 그 표 grant 정의가 저장소에 없음]. 상한에 닿으면 그 달은 요약 없이 제목만 넣는다.
- **종합지·방송사 늘리기 예상(11/04, [추정])**: 매체 피드 호출 하루 3번 × 매체 약 16곳 = 약 48번(요청 사이 2초 간격 유지), 키워드 일치 통과 건수는 작업공간당 하루 약 10~30건 예상(키워드 10~30개 기준, 같은 사건 중복 포함). AI 호출은 늘지 않는다(글자 일치만, 소개는 피드에 든 것 그대로). 해외 기사 한국어 소개 번역은 제목 번역과 같은 호출에 묶여(PR NEWS-태그글자) 건수만큼 입력 토큰이 조금 늘 뿐이다.
- 요약 문구 규칙은 사회운동 Now와 같다: 본문 60자 미만이면 AI 안 부름, '요약할 수 없음'류 답은 비움(`AI_NO_MATERIAL_PATTERNS`), 한 줄 120자 안쪽, `AI_TONE_RULE`.
- 결정 N3에서 "② 요약 안 함"을 고르면 ②는 0번 → 하루 약 20번·한 달 약 520원.

## 5. 저작권·보관 경계

- **바뀜(2026-11-06, D1)**: 아래 표의 '보관하지 않음 — 기사 본문·발췌·사진'은 더 이상 맞지 않는다. 본문(문단)·사진 주소·캡션을 작업공간 소유자만 보는 표에 저장하고, 사진 파일 자체는 복사하지 않는다(화면이 원래 주소로 띄움). 전문 번역은 누를 때만, 공개 경로로 내보내기 없음 — news-overhaul.md 4절. 아래는 처음 설계 기록.

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

- 메뉴: ~~`app/menu-model.mjs`에 `{id:'news', label:'뉴스 클리핑'}`를 `outside` 바로 다음에~~ → **바뀜(2026-11-02, 13절)**: 독립 메뉴 `news`는 빼고 'Now' 메뉴(`id:'outside'`)의 [뉴스] 탭으로. 세 칸(내 스크랩·키워드·매체)은 탭 안 칩 한 줄로.
- 한 화면에 세 칸(PC 1440은 세 칸 나란히, 폰 412는 칸 이름 줄 [내 스크랩 · 키워드 · 매체] + 좌우 밀기):
  - ① 내 스크랩(11/04 NEWS-채널자동빼기: 채널/자동 칩·꼬리표는 화면에서 삭제 — 칩은 [전체][별표]뿐, 둘뿐이라 별표는 목록을 거르는 칩이 아니라 폴더 보기로 바뀌는 칩 그대로 둠. lane 값·수집 방식은 그대로): 날짜 묶음 머리 → 줄마다 `매체 · 시각`(작게) / 제목 / 한 줄 요약 / [원문]. 대기 줄은 도메인 + '읽는 중'. robots 막힘은 도메인 + '사이트가 자동 읽기를 막아 둠'.
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

11/08(S53-6): khan.co.kr/help/help_rss.html · khan.co.kr/rss/rssdata/english_news.xml · m.ohmynews.com/NWS_Web/Help/srv/h_help_rss.aspx · hankyung.com/feed · nocutnews.co.kr/rss/ · news.sbs.co.kr/news/rss.do · (robots로 못 염) imnews.imbc.com/rss/index.html·rss.hankooki.com·11.vop.co.kr · newstapa.org/author/webmaster. 검색 도구가 사이트 검색을 거절: hani.co.kr·chosun.com·joongang.co.kr·donga.com·mk.co.kr·yna.co.kr·jtbc.co.kr·kbs.co.kr·theguardian.com.

labortoday.co.kr/rssIndex.html · laborplus.co.kr(하단 RSS 링크) · beminor.com/rss/allArticle.xml · worknworld.kctu.org · newscham.net · mediatoday.co.kr · pressian.com(하단 RSS 링크) · khan.co.kr/rss/rssdata/english_news.xml · moel.go.kr/site/rss/rssList.do · korea.kr/etc/ministry.do · korea.kr 공지(RSS 중단, 검색 결과) · publicservices.international · itfglobal.org/en/news · equaltimes.org · labourstart.org/lnwnews.shtml · feeder.co 안내(Guardian·AP·Reuters) · metawatch.iptc.org(NHK) · newscatcherapi.com·codewords.ai(구글 뉴스 RSS 검색 변수). 열지 못한 주소: 각 사이트 `/robots.txt`, news.google.com/robots.txt, pressian.com/rss, labortoday.co.kr/rss/allArticle.xml, itfglobal.org/en/rss/feed, publicservices.international/feed.xml.

## 13. Now 메뉴로 합침 · 같은 글 상세 · 같은 관심사 (2026-11-02, S48-14 — 명진 결정 11/01 23:16)

- **메뉴**: 이 설계의 독립 메뉴 '뉴스 클리핑'(0절 1·6절)은 명진 결정으로 바뀌었다 — 사회운동 Now와 **한 메뉴 'Now' + 소탭** [사회운동] [뉴스] [보관] [문장 찾기]. 뉴스 클리핑 화면은 [뉴스] 탭이 되고, ① 내 스크랩(구독 채널)·② 키워드·③ 매체는 탭 안 **칩**(지금의 세 칸 → 칩 한 줄). 폰은 좌우 밀기로 탭 이동, 마지막 탭은 서버 기억(`view_prefs.now_tab`). 자세한 것: [outside-statements.md](outside-statements.md) 12.1.
- **[보관] 탭**: 뉴스 별표(`starred_at`)·별표 폴더(= 보관)는 사회운동 글의 별표·보관과 한곳에 보인다. 뉴스 쪽 저장 칸은 그대로(새 칸 없음).
- **글 상세**: 뉴스 기사도 사회운동 글과 **같은 상세 부품**(`app/now-detail.js`)·같은 상세 저장(`app_now_details.news_item_id`)·같은 만들기 길(`ai-assist` kind `now_detail`)을 쓴다. 재료는 `app_news_items.body`(공개 본문 또는 리드)·요약·제목. 외국어 기사의 주요 문장 번역은 문장 3개까지 짧은 인용만(전문 번역은 지금처럼 [번역]을 누를 때만 — 10절 '외국어 번역').
- **관심사 하나**: 별표·보관·메모·관심 없음·원문 열기 기록(`app_now_signals.news_item_id`)과 관심 주제(`app_now_interests`)는 사회운동과 **같은 표 하나**를 쓴다(두 벌 안 만듦). 키워드(찾아올 낱말)와 관심 주제(나에게 중요한 쟁점)는 따로다.
- **저녁 알림**: 한 줄로 합침 '새 성명 n · 새 기사 n'.
- **목록 순서**: 시간순 그대로, 확정 관심 주제에 걸린 기사에만 작은 표시.
- PR 순서·DB·보안은 outside-statements.md 12.5~12.8.
