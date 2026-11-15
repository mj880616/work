# AI-비용보기 — 프로필 'AI 비용' 칸 설계 (S60-8)

- 원장 행(제안): AI-비용보기. 이 문서는 설계·시안만이다. 앱 코드·DB·Edge는 바꾸지 않는다.
- 시안: `docs/design/mockups/ai-cost-view.html`, 사진 `docs/design/mockups/ai-cost-view/`.
- 공개 저장소라 금액 숫자·계정 정보는 쓰지 않는다. 시안 숫자는 모두 가짜다.

## 0. 명진 요청과 한 줄 결론

> "웹2 사용하면서 실제로 얼마가 들고, 어느 주기로 얼마를 충전해야 지금 서비스를 지속가능한지를 알고싶은거야. 웹2 안에서도 기능별로 얼마가 들고" / "1회성으로 알려주는거 말고 … 웹2 안에서 볼 수 있게 프로필 칸 안에서"

**결론**: 프로필 '수집·사용량' 칸의 'AI 사용량' 한 줄(`app/ai-usage-line.js`)을 'AI 비용' 칸으로 키운다(새 화면을 옆에 만들지 않고 같은 자리·같은 렌더러를 넓힘). 그 전에 **빠진 기록 두 군데(통화 전사·분석, 뉴스)**를 메우고, **OpenAI 기능 구분 칸**을 더해야 기능별 금액이 맞는다. 실제 청구 대조는 OpenAI는 관리자 열쇠(Admin key)로 자동 가능, Gemini는 공식 읽기 길이 사실상 없어 'Web2 추정 + 대시보드 바로가기'로 한다.

## 1. 지금 AI를 부르는 곳 전수 표

조사 기준: 최신 main(`8cdcb11`)에서 `api.openai.com`·`generativelanguage.googleapis`·`GEMINI_API_KEY`·사용량 표 이름을 전부 검색(`supabase/functions/**`, `app/`, `docs/ops/`, `windows-app/`, `basket-pc/`, `android-app/`, `scripts/`).

| 기능(화면 말) | 부르는 곳 | 공급자·모델 | Web2에 사용량이 남나 | 남는 표 | 지금 홈·프로필 줄에 잡히나 | 빠진 것 |
| --- | --- | --- | --- | --- | --- | --- |
| Web2 AI 기능 전체(원장 자동 기록·업무일지 초안·한 줄 정리·챙길 것·묻기·주간 정리·자료 채우기 등 30여 갈래) | Edge `ai-assist` | OpenAI, 비밀값 `WEB2_AI_MODEL`(기본 `_shared/ai-model.ts`) | 남음(토큰) | `app_ai_daily_usage`(작업공간·사람·날짜 1행) | 잡힘(한 덩어리) | **기능 구분 없음** — 원장·업무일지·묻기를 나눠 볼 수 없음 |
| 자료실 파일 읽기·요약 | Edge `library-files` | OpenAI, `app_ai_workspace_settings.default_model` | 남음 | `app_ai_daily_usage`(토큰만, 횟수 안 더함) | 잡힘(위와 섞임) | 기능 구분 없음 |
| 회의 자료 넣기(추출) | Edge `meeting-ai-ingest` | OpenAI, 같은 표 설정 | 남음 | `app_ai_daily_usage` | 잡힘(섞임) | 기능 구분 없음 |
| 자료 색인(요약·핵심어) | Edge `document-ai-index` | OpenAI, 같은 표 설정 | 남음 | `app_ai_daily_usage` | 잡힘(섞임) | 기능 구분 없음 |
| 회의 요약(새 회의 초안) | Edge `meeting-ai-draft` | OpenAI | 남음 | `app_ai_daily_usage` | 잡힘(섞임) | 기능 구분 없음 |
| 회의 녹음 전사 | Edge `meeting-transcribe` | Gemini `gemini-3.5-transcribe`(비밀값 `GEMINI_API_KEY`) | 남음 | `app_ai_external_usage`(ref `mtg-`, 실패 시도 `mtgfail-`) | 잡힘(Gemini 전사) | 없음 |
| 회의 녹음 뒤 서버 요약 | Edge `meeting-transcribe` 안의 요약 한 번 | OpenAI | 남음 | `app_ai_daily_usage` | 잡힘(섞임) | 기능 구분 없음 |
| 텔레그램 판정 | Edge `collector-feed`(source `telegram`) | OpenAI, `WEB2_AI_MODEL` | 남음 | `app_feed_days.ai_*` | 잡힘(텔레그램·통화 판정) | 없음 |
| 통화 판정(전사본 분류) | Edge `collector-feed`(source `call`) | OpenAI | 남음 | `app_feed_days.ai_*` | 잡힘 | 없음 |
| **통화 전사** | 명진 Google 앱 스크립트(저장소 밖, `docs/design/call-telegram-feed.md` 1.2) | Gemini | **안 남음(추정)** | (`app_ai_external_usage` source `transcript`로 보내는 길은 있음) | **안 잡힘** | 보고 코드 없음 |
| **통화 분석(검토 md)** | 같은 앱 스크립트 | Gemini | **안 남음(추정)** | (같은 표 source `analysis` 길은 있음) | **안 잡힘** | 보고 코드 없음 |
| **뉴스 요약·제목·[번역]** | Edge `news-feed` | OpenAI | 남음 | `app_news_days.ai_*` | **안 잡힘** | `drive-summary` 합산에 `app_news_days`가 없음 |
| **사회운동 [번역]** | Edge `outside-feed` | OpenAI | 남음 | `app_news_days.ai_*`(뉴스와 같은 줄) | **안 잡힘** | 위와 같음 |
| (옛) 팀 AI 초안 | Edge `page-ai-draft` | OpenAI | 남음 | `app_ai_daily_usage` | — | 앱에서 부르지 않음(정리 대상, 이 작업 범위 밖) |

월 상한(서버가 실제로 막는 기준, `_shared/ai-prices.mjs`·각 함수): `ai-assist` 15,000원 · `collector-feed` 6,000원 · 뉴스·사회운동 [번역] 5,000원(`_shared/news-days.ts`) · 회의 전사 15,000원(`meeting-transcribe/model.mjs`). 이 숫자는 Web2 자체 단가로 센 **추정**이고, 공급자 쪽 한도(Gemini 월 지출 한도, OpenAI 크레딧)와는 별개다.

### 1.1 통화 전사가 안 잡히는 원인

- **사실**: 이번 달 `app_ai_external_usage`에는 `mtg-`·`mtgfail-`(회의 전사)만 있다(CC 11/12 확인). Google 실제 지출은 Web2 회의 전사 추정보다 훨씬 크다.
- **사실**: 보고 길(`drive-summary` `POST ?action=ai_usage`, 수집 점검 신호와 같은 비밀값 머리글)은 10/28부터 열려 있다. 그러나 저장소의 앱 스크립트 문서(`docs/ops/collector-heartbeat.gs`·`collector-feed.gs`)에는 이 보고를 부르는 코드가 없다. 원장 AI-사용량줄 행의 "명진 할 일: 앱 스크립트에 보고 함수 붙여 넣기"가 끝났다는 기록도 없다.
- **추정**: 통화 전사·분석 앱 스크립트가 Gemini를 부른 뒤 사용량을 보내지 않는다. 그래서 Gemini 지출의 대부분(통화)이 Web2에 없다.
- 확인 방법: 앱 스크립트 편집기에서 `ai_usage` 문자열 검색(명진 또는 브라우저 연결된 CC). 없으면 2단계(5절)로 메운다.
- **2단계 확인 결과(S60-25, 11/12)**: 저장소 전체(`docs/ops`·`scripts`·`windows-app`·`basket-pc`·`android-app`)에 `ai_usage`를 보내는 코드가 없다(사실). 서버는 받은 보고를 source(`transcript`/`analysis`)로만 나눠 **회의 전사(`mtg-`)와 통화 전사가 같은 '전사' 칸에 섞였다**(사실, `drive-summary/ai-usage.mjs`). 또 외부 보고 읽기가 1000행에서 실패하게 되어 있어, 통화 보고가 붙으면 한 달 안에 AI 사용량 줄 전체가 실패할 수 있었다(사실). 2단계 PR에서 ① 보고 함수 `docs/ops/ai-usage-report.gs` ② ref 앞머리로 나눈 `gemini.by_kind`(회의·통화 전사·통화 분석) ③ 1000행씩 차례 읽기(최대 20쪽) ④ 수집 비밀값 보고로 `mtg-`·`mtgfail-` 거절(회의 월 상한 보호)을 더했다. 실제 앱 스크립트 편집기 검색은 웹 세션이라 못 했다(붙일 때 CC가 브라우저로 확인).

### 1.2 그 밖의 발견

- 원장 `AI-사용량세함수`(대기)는 이미 코드에 반영돼 있다(`library-files`·`meeting-ai-ingest`·`document-ai-index` 모두 `recordAiDailyUsage` 호출). 원장 정리 필요(범위 밖, 보고만).
- 지금 줄의 월말 예상은 '지금까지 합 ÷ 지난 날 × 그 달 날'(단순 비례)이라 월초에 크게 흔들린다(4절에서 바꿈).

## 2. 기능별 금액을 계속 세려면 필요한 기록

원칙: 새 상태 저장소를 늘리지 않고, 있는 표·길을 먼저 쓴다. 기록은 숫자·모델 이름·기능 이름만(글·AI 답·파일 이름 없음).

### 2.1 DB 변경 없이 되는 것

1. **통화 전사·분석 보고**: 이미 있는 `POST ?action=ai_usage`에 ref 앞머리 `call-`(전사)·`calla-`(분석)로 보낸다. source는 `transcript`·`analysis` 그대로. 회의 전사(`mtg-`)와 ref 앞머리로 나눠 센다. 앱 스크립트에 붙일 함수 원문은 2단계 PR에서 `docs/ops/ai-usage-report.gs`로 둔다(비밀값은 스크립트 속성에만, 코드·문서에 없음).
2. **뉴스·사회운동 합산**: `drive-summary`가 `app_news_days.ai_*`도 소유자 토큰으로 읽어 더한다(표·RLS 그대로, 읽기만).

### 2.2 DB 변경이 필요한 것 (별도 PR, 짝 파일 5개, 정지 지점)

**(가) OpenAI 기능 구분** — 새 표 `app_ai_usage_events` 제안(넣기만, 고치기·지우기 없음):

| 칸 | 뜻 |
| --- | --- |
| `workspace_id` | 소유 작업공간(서버가 정함) |
| `day` | 서울 날짜 |
| `feature` | 기능 키(아래 목록만, check 제약) |
| `provider` | `openai` |
| `model` | 모델 이름(형식 검사) |
| `calls`·`input_tokens`·`output_tokens` | 숫자 |
| `created_at` | 시각 |

- 왜 `app_ai_daily_usage`에 칸을 더하지 않나: 그 표는 (작업공간·사람·날짜) 1행이고 `requests`를 하루 80회 한도로 쓴다. 기능 칸을 넣으면 기본 키·한도 계산이 바뀌어 `ai-assist` 전체를 흔든다. 기존 표·한도는 그대로 두고, 기능별 표는 옆에 **더하기만** 한다(한도 판정은 지금 표 그대로).
- 기능 키(제안, `_shared/ai-features.mjs` 한 곳): `ledger`(원장 자동 기록·후보·수정) · `journal`(업무일지 초안·한 줄·기억할 일·주간 정리) · `ask`(Web2에 묻기) · `todo`(챙길 것·재확인) · `library`(자료실 채우기·파일 읽기·색인) · `meeting`(회의 요약·자료 넣기·녹음 뒤 요약) · `org`(조직 요약·현황) · `telegram`·`call_judge`(판정) · `news`(뉴스·사회운동 번역) · `other`. `ai-assist`의 갈래 이름 → 기능 키 표도 같은 파일에 둔다.
- 권한: authenticated는 소유자(`private.app_is_workspace_owner`) 읽기만 + `ai-assist`가 로그인 토큰으로 넣을 칸 grant(소유자 with check). service_role은 넣기 칸만(읽기 없음). anon·PUBLIC 없음. `app_ai_external_usage`와 같은 모양.
- 양: 호출 묶음당 1행. 한 달 수천 행 수준(추정) — 13개월 넘은 행 정리는 나중 별도 결정.

**(나) 공급자 한도·충전 설정** — `app_ai_cost_entries.kind`에 `cap`(Gemini 후불 월 한도)·`reload`(OpenAI 자동 충전 금액) 더하기. 명진이 프로필에서 한 번 넣으면 4절 계산이 '한도까지 며칠'을 보여 준다. (`view_prefs`는 DB가 키 모양을 엄격히 검사하므로 거기 넣으려 해도 DB 변경이 필요 — 금액 성격이 같은 이 표가 맞다.)

## 3. 실제 청구 금액과 맞추기

| 공급자 | 공식으로 읽는 길 | 이 설계의 선택 |
| --- | --- | --- |
| OpenAI | **Costs API** `GET /v1/organization/costs`(날짜별 금액, `group_by=line_item`·`project_id`). **조직 관리자 열쇠(Admin key)**가 있어야 한다. 크레딧 **잔액은 API로 주지 않는다**(커뮤니티 확인). | 명진 결정 대기. 하면: 새 서버 비밀값 1개, `drive-summary` GET이 이번 달·지난달 실제 금액을 읽어 '실제' 표시와 보정 비율에 씀. 안 하면: 추정 + 대시보드 바로가기. |
| Gemini(AI Studio) | 공식 문서에 **지출을 읽는 API가 없다**. AI Studio 결제·지출 화면, Cloud Billing 보고서(하루 늦음)뿐. 프로그램으로는 **Cloud Billing → BigQuery 내보내기**만 있다(서비스 계정 열쇠·BigQuery 설정 필요, 하루 늦음). | 'Web2 추정 + AI Studio 지출 화면 바로가기'. BigQuery 길은 무겁고 열쇠가 하나 더 늘어 하지 않는다(다시 볼 조건: 추정과 실제 차이가 계속 크면). |

보안(관리자 열쇠를 쓰기로 할 때):

- 관리자 열쇠는 조직 설정·열쇠 관리까지 할 수 있는 강한 열쇠다. **서버 비밀값(`production-edge`가 아니라 Supabase Edge 비밀값)에만** 두고, 화면·로그·PR·채팅에 값이 나오지 않게 한다. 이름 제안 `WEB2_OPENAI_ADMIN_KEY`.
- 읽는 것은 costs 한 주소뿐(코드에서 주소 고정). 답에서 숫자(날짜·금액)만 꺼내고 나머지는 버린다.
- 프로필을 열 때마다 부르지 않고 탭당 10분 한 번(지금 수집 칸과 같은 요청에 얹음).
- OpenAI 조직 화면에서 관리자 열쇠 권한을 좁힐 수 있으면 읽기만으로 만든다(만들 때 확인). 좁힐 수 없으면 그 위험을 명진이 판단한다.
- 기존 결정과의 관계: AI-사용량줄(10/28)은 "관리자 키는 쓰지 않음"으로 만들었다. 이번에 쓰려면 **명진이 그 결정을 바꾸는 것**이다.

## 4. '얼마를 언제 충전' 계산 규칙

모두 서버(`drive-summary`)가 원 단위로 셈하고 화면은 보여 주기만 한다(지금 구조와 같음).

1. **하루 평균**: 최근 14일(이번 달이 14일보다 짧으면 지난달 끝을 이어서) 합 ÷ 14. 공급자별·기능별로 따로.
2. **월말 예상**: 이번 달 지금까지 + 남은 날 × 하루 평균. 실제 청구가 있으면(OpenAI Costs API) '지금까지'를 실제로 바꾸고, 없으면 지난달 보정 비율(실제 ÷ 추정, 0.25~4)을 곱한다(지금 `ratioFor`와 같은 규칙).
3. **OpenAI(선불 + 자동 충전)**:
   - 한 달 예상 ÷ 자동 충전 금액 = 한 달 충전 횟수. "자동 충전 ○원씩이면 한 달 약 n번"으로 보여 준다.
   - 권장 자동 충전 금액 = 한 달 예상의 절반을 1만 원 단위로 올림(한 달 2번 안팎). 권장 '잔액 기준'(이 아래면 충전) = 최근 7일 중 가장 많이 쓴 하루 × 3(사흘 여유), 1천 원 단위 올림.
4. **Gemini(후불 + 월 지출 한도)**:
   - 한도까지 남은 날 = (한도 − 이번 달 지금까지) ÷ 하루 평균. 그날이 이번 달 안이면 경고 "이 속도면 ○일에 한도 — 회의·통화 전사가 멈춤".
   - 권장 한도 = max(월말 예상 × 1.3, 지난 3달 실제 최대 × 1.2), 1천 원 단위 올림. 지금 한도가 이보다 낮으면 "한도를 ○원으로 올리기 권장".
5. **경고 순서**(한 줄만 노랗게): Gemini 한도 도달 예상 > Web2 서버 상한 80%(지금 규칙 그대로) > OpenAI 충전 잦음(한 달 4번 넘음).
6. **환율**: 1달러 = 1,400원 한 곳(`_shared/ai-prices.mjs`). Costs API가 달러로 주므로 같은 환율로 바꾼다.

## 5. 단계별 PR

| 순서 | PR | 바뀌는 곳 | 정지 지점 | 의존 |
| --- | --- | --- | --- | --- |
| 1 | 이 PR | 설계·시안 문서 | 없음 | — |
| 2 | 통화 전사·분석 보고 붙이기 | `docs/ops/ai-usage-report.gs`(앱 스크립트 붙일 함수, ref `call-`·`calla-`) + 붙여 넣기(명진 또는 브라우저 연결된 CC) | 없음(DB·Edge 그대로) | — · **가장 먼저**(Gemini 차이의 원인) |
| 3 | 뉴스 합산·4절 계산 | `drive-summary/ai-usage.mjs`(뉴스 읽기, 14일 평균, 공급자별 권장) | Edge 배포 1개 | 2와 병렬 가능 |
| 4 | DB: 기능별 표·한도 종류 | migration + 짝 파일 5개(`app_ai_usage_events`, `app_ai_cost_entries.kind`에 `cap`·`reload`) | DB 적용(시험 먼저) | 3 뒤 |
| 5 | 기능 이름 기록 | `_shared/ai-features.mjs`, `_shared/ai-daily-usage.mjs`, `ai-assist` 등 9개 함수 | Edge 배포 여러 개(한 번에 하나, 되돌리기 ref) | 4 적용 뒤 |
| 6 | 화면: 프로필 'AI 비용' 칸 | `app/ai-usage-line.js`·`ai-usage-model.mjs`를 키움(같은 상태 소유자·렌더러), 한도·자동 충전 금액 입력 한 줄, 업데이트 기록 | 없음 | 3·5 뒤(5 전엔 OpenAI가 '기능 구분 전'으로 한 줄) |
| 7 | (명진이 하기로 하면) OpenAI 실제 금액 대조 | `drive-summary`에 Costs API 읽기 | 비밀값 등록(명진) + Edge 배포 | 6 뒤 언제든 |

## 6. 화면 (시안 요약)

자리: 프로필 '수집·사용량' 칸 안, 지금 'AI 사용량' 줄 자리. 접힌 상태 한 줄 → 펼치면 아래.

1. **머리 한 줄**(늘 보임): "AI 비용 · 11월 1~12일 · 합계 ○원 · 월말 약 ○원" + 경고가 있으면 노란 줄 하나.
2. **공급자 2줄**: OpenAI(선불) 이번 달 ○원 / 월말 ○원 / 권장 자동 충전 / 대시보드↗. Gemini(후불) 이번 달 ○원 / 한도 ○원 중 ○% 막대 / '○일에 한도' / 대시보드↗. 각 줄에 '추정' 또는 '실제' 꼬리표.
3. **기능별 표**(금액 큰 순, 상한 있는 줄은 작은 막대): 회의 녹음 전사 · 통화 전사 · 통화 분석 · 텔레그램 판정 · 통화 판정 · 뉴스·번역 · 원장 자동 기록 · 업무일지 · 자료실 · 회의 요약 · Web2에 묻기 · 그 밖. 5단계 전에는 OpenAI 기능 줄 대신 'Web2 AI 기능(기능 구분 전)' 한 줄.
4. **추세**: 최근 30일 하루 금액 작은 막대(공급자 두 색, 톤다운).
5. **접힌 세부**: 계산 방법 한 줄, 한도·자동 충전 금액 입력(서버 저장), 기록이 빠진 기능 안내.

폰 412가 기준(표는 2칸: 이름 / 금액), PC 1280은 공급자 2줄을 나란히, 기능 표 4칸(이름·이번 달·월말·상한).

## 7. 하지 않는 것

- 열쇠 값을 화면·로그·문서·채팅에 두기. 화면에서 공급자 API를 직접 부르기.
- 브라우저 저장(로컬 스토리지)에 한도·충전 금액 두기(서버 저장만).
- 기존 한도 계산(`app_ai_daily_usage.requests` 하루 80회, 월 상한)을 기능별 표로 옮기기 — 막는 기준은 그대로 둔다.
- Gemini BigQuery 내보내기(3절 이유).
