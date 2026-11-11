# BIZ-보고할일정 — 보고할 일정 표시 · 사업 보고 ↔ 일정 잇기 (설계 · 1단계 DB)

요청함 2026-11-11 07:03 → 07:08 접수(①~⑤ 모두 승인, 표시 기호 □). 시안: `docs/design/mockups/biz-report-plan-link.html`.
이 문서는 1단계(DB)의 설계와, 뒤따를 화면 PR이 따를 규칙·나눔 계획을 적는다. 화면은 이 단계에서 고치지 않는다.

## 0. 한눈에

- 일정(Google Calendar)에 '보고할 일정' 표시를 서버에 저장할 **새 표 하나**(`app_calendar_report_plans`)를 만든다.
- 사업 보고(`app_meetings`)에 **일정 id 칸 두 개**(`google_calendar_id`, `google_event_id`)를 더해 보고 ↔ 일정을 진짜 연결로 묶는다.
- '같은 이름 기억'은 따로 저장 칸을 만들지 않는다. 새 표에 쌓인 결정(켬·빼기)에서 계산한다(BIZ-사업영역기억과 같은 방식).
- 권한 경계는 그대로다: 소유자만(`private.app_is_workspace_owner`), anon·PUBLIC·service_role 권한 없음, 함수·트리거 없음.
- migration은 하나다: `20261111020000_report_plan_event_link`(새 표 + 사업 보고 칸). 화면이 둘을 같이 쓰므로 한 번에 들어가거나 하나도 안 들어가게 했다(시험 적용·적용 한 번씩).

## 1. 요청과 이 단계의 범위

| 번호 | 요청 | 필요한 저장 | 이 단계 |
| --- | --- | --- | --- |
| ① | 일정에 '보고할 일정' 켜고 끄기(메뉴·일정 창) | 일정마다 켬 / 끔 / 빼기 | 새 표 |
| ② | 같은 이름이면 저절로 켜짐, 담당조직 연결 일정은 점선 □ '보고할까요?', [빼기]면 다시 묻지 않음 | 이름별 기억 | 새 표의 결정에서 계산(칸 추가 없음) |
| ③ | '안 쓴 보고 n ›' 한 줄 | 지난 보고할 일정의 날짜·제목 | 새 표의 날짜·제목 칸 |
| ④ | 사업 보고 ↔ 일정을 일정 id로 연결, ✓·□·● 표시 | 보고에 일정 id | 사업 보고 표 칸 2개 |
| ⑤ | [보고 쓰기] 창에 그 시각 사진 미리 묶기 | 없음(기존 사진 길 그대로) | 해당 없음 |

화면(①~⑤ 전부)과 브라우저 E2E는 다음 세션이 한다. 이 단계의 완료 기준은 "DB PR이 CI 녹색이고 커맨드센터가 승인형 workflow로 시험 적용 → 적용만 하면 되는 상태"다.

## 2. 지금 구조(조사 결과)

| 무엇 | 지금 어디에 있나 | 근거 |
| --- | --- | --- |
| 일정 원본 | Google Calendar. 옛 Web2 자체 일정 표(`app_events`)는 화면에서 걷어 내 쓰지 않는다(CAL-웹2일정삭제). 화면은 `(calendarId, eventId)`로 일정을 가리킨다 | `app/calendar-context-menu.js` `addressOf`, Edge `google-calendar` |
| 일정 ↔ 담당조직 | Google 일정의 비공개 확장 속성(`kptu_suborg_ids`)에 조직 id 목록 | `supabase/functions/google-calendar/index.ts` `normEvent` |
| 일정 ↔ 사업영역 | `app_project_milestones`의 `google_calendar_id`·`google_event_id` 짝(사업영역마다 한 행, 제목·시작 시각 사본 포함). 찾을 때는 `google_event_id`만으로 찾는다 | `20260925032810_add_project_milestone_google_linkage.sql`, `app/quick-save.js` `eventAreaRows` |
| 사업 보고 | `app_meetings`(작업공간, 회의명 `series_name`·`title`, 일시 `meeting_at`, 칸 `activity_kind`, 장소, 참석인원, 사업영역, 휴지통 `deleted_at`) | `20261022182319`·`20261023023500`·`20261025100000`·`20261110231000` |
| 사업 보고 ↔ 일정 | **연결 없음.** [결과 남기기]는 일정 제목·시작·장소를 채운 쓰기 창만 열고, 중복은 '같은 날·같은 이름'으로만 묻는다 | `app/calendar-interactions-v2.js` `ciLeaveReport`, `app/team.js` `KPTUReportEntry.open`(`dedupe`) |
| 같은 이름 판정 | 공백을 모두 빼고 소문자로 바꾼 글자 | `app/team.js` `meetingNameKey` |
| 같은 이름 기억(사업영역) | 저장 칸 없음. 같은 이름 보고 중 가장 나중에 정한 값을 계산해 쓴다 | `app/business-area-model.mjs` `rememberedArea` |
| 사업 보고 권한 | 소유자 정책 `task12a_owner_all`(authenticated) + 휴지통 가리는 restrictive 정책. 표 단위 권한(칸 단위 아님) | `20260925084844_task12a_sole_owner_db.sql`, `20261025100000_trash_org_report_db.sql` |

그래서 지금은 일정 달력에서 어느 일정을 보고했는지 알 수 없고, '보고할 일정'을 적어 둘 곳도 없다.

## 3. 정한 것 — DB

### 3-1. 새 표 `app_calendar_report_plans` (①·②·③)

일정 하나에 줄 하나. 그 일정을 '보고할 일정'으로 볼지에 대한 **결정**을 적는다.

| 칸 | 형 | 뜻 |
| --- | --- | --- |
| `id` | uuid, 기본값 `gen_random_uuid()` | 줄 id |
| `workspace_id` | uuid, 필수 | 작업공간(지우면 같이 지워짐) |
| `google_event_id` | text, 필수 | 일정 id. 작업공간 안에서 하나뿐(`unique (workspace_id, google_event_id)`) |
| `google_calendar_id` | text, 필수 | 그 일정의 캘린더 id(일정 창을 열 때 쓴다) |
| `state` | text, 필수 | `on` 보고할 일정 · `off` 끔(이 일정은 보고 안 함) · `skip` 빼기(다시 묻지 않음) |
| `decided_by` | text, 기본값 `user` | `user` 사람이 정함 · `rule` 같은 이름 기억으로 저절로 켜짐(`rule`은 `on`만) |
| `decided_at` | timestamptz, 기본값 `now()` | 결정한 때('가장 나중 결정'을 가리는 기준) |
| `title` | text, 필수 | 일정 제목 사본(1~300자, 한 줄) |
| `event_day` | date, 필수 | 일정 시작 날짜(서울 기준) |
| `starts_at` | timestamptz | 시작 시각. 종일 일정은 비움 |
| `created_at` | timestamptz, 기본값 `now()` | 만든 때 |

- 검사: 일정 id는 빈칸·제어 글자 없는 ASCII 1~1024자, 캘린더 id는 빈칸 없는 1~255자, 제목은 1~300자 한 줄, 날짜는 2000~2100년, `rule` 줄은 `on`만.
- 색인: `unique (workspace_id, google_event_id)`, `(workspace_id, event_day desc)`.
- 일정 id만으로 하나뿐으로 본 이유: 화면이 캘린더 id를 `primary`와 실제 주소 두 가지로 부를 수 있어, 캘린더 id까지 묶으면 같은 일정에 줄이 둘 생길 수 있다. 사업영역 연결(`eventAreaRows`)도 일정 id만으로 찾는다.
- 제목·날짜 사본을 두는 이유: '안 쓴 보고' 줄과 사업 보고 달력의 □가 Google을 다시 부르지 않고도 그려져야 한다(지난달 것도 포함). 사업영역 주요 일정 행이 제목·시작 시각 사본을 두는 것과 같은 방식이다. 화면은 일정을 볼 때 사본이 다르면 고쳐 쓴다(4-5).
- 되풀이 일정은 회차마다 일정 id가 다르다. 회차마다 줄이 따로 생기고, 회차 사이는 '같은 이름 기억'이 이어 준다.

### 3-2. 사업 보고 표 칸 (④)

`app_meetings`에 칸 두 개를 더한다(둘 다 비워도 됨, 기본값 없음 → 기존 보고는 모두 빈 칸이라 지금 화면 그대로).

| 칸 | 형 | 뜻 |
| --- | --- | --- |
| `google_calendar_id` | text | 이어진 일정의 캘린더 id |
| `google_event_id` | text | 이어진 일정 id |

- 검사: 둘 다 비었거나 둘 다 채움(`app_project_milestones`의 짝 검사와 같은 규칙), 길이·글자 검사(새 표의 일정 id·캘린더 id와 같은 규칙).
- 색인: `(workspace_id, google_event_id) where google_event_id is not null`.
- 한 일정에 보고가 둘 이상일 수 있다(지금도 '같은 날 같은 이름' 물음에서 [새로 만들기]를 고를 수 있다). 그래서 하나뿐 검사는 두지 않는다. 화면은 가장 나중 보고를 연다.
- 보고를 휴지통에 넣으면 기존 restrictive 정책이 그 줄을 가리므로 일정 달력의 ✓는 저절로 □로 돌아간다.
- BIZ-달력우클릭끌기 결정(가: 보고를 옮겨도 Google 일정 그대로)과 충돌하지 않는다. 연결은 날짜가 아니라 일정 id라서 보고 날짜를 옮겨도 이어진 채로 남는다.

### 3-3. 권한·RLS

- 새 표: RLS 켬, 정책 하나 `calendar_report_plans_owner_all`(authenticated, `private.app_is_workspace_owner(workspace_id)`), PUBLIC·anon·service_role 권한 없음.
  authenticated는 읽기·지우기(표 단위), 넣기(`id`와 값 칸 — `created_at`은 못 넣음), 고치기(값 칸 — `workspace_id`·`google_event_id`·`id`·`created_at`은 못 고침).
- 사업 보고 표: grant·정책·RLS 변경 없음. 표 단위 권한이라 새 칸도 소유자만 읽고 쓴다(참석인원 칸과 같음).
- 함수·트리거·view·시퀀스 없음. `rtw_*` 객체는 건드리지 않는다.

### 3-4. 만들지 않은 것과 이유

- **이름 기억 표·프로필 칸**: 만들지 않는다. 결정 줄에서 계산하면 저장할 곳이 하나라 어긋날 일이 없다(4-2).
- **표시를 Google 일정 확장 속성에 넣기**: 쓰기 권한이 없는 캘린더(조직 참고 캘린더 등)의 일정에는 쓸 수 없고, '안 쓴 보고'를 세려면 매번 Google을 불러야 해서 쓰지 않는다.
- **보고 줄에 '보고할 일정' 표시 넣기**: 보고를 쓰기 전 상태를 적을 곳이 없어 안 된다.
- **연결을 새 표 쪽에 두기(`meeting_id`)**: 한 일정에 보고 하나만 되고, 휴지통에 간 보고를 따로 걸러야 해서 쓰지 않는다.

## 4. 화면이 따를 규칙(다음 PR)

순수 규칙은 새 모듈 하나(예: `app/report-plan-model.mjs`)에 두고 일정 달력·사업 보고 달력·홈이 같이 쓴다.

### 4-1. 일정 하나의 표시

1. 이 일정 id에 이어진 보고(휴지통 아님)가 있으면 **보고 씀**(일정 달력 ✓, 사업 보고 달력 ●).
2. 아니고 결정 줄이 있으면 그 값: `on` → **보고할 일정**(□), `off`·`skip` → 표시 없음.
3. 결정 줄이 없으면 이름 기억(4-2): 기억이 `on`이면 □(4-3대로 줄을 만든다), `skip`이면 표시 없음.
4. 기억도 없고 담당조직이 연결된 일정이면 **보고할까요?**(점선 □, 사업 보고 달력에서만).
5. 그 밖에는 그냥 일정.

### 4-2. 같은 이름 기억

- 이름 열쇠는 `meetingNameKey`(공백 빼고 소문자)와 같은 규칙. 모델로 옮겨 한 곳에서 쓴다.
- 기억 = 같은 이름 열쇠의 결정 줄 중 **사람이 정한(`decided_by = user`) `on` 또는 `skip`** 가운데 `decided_at`이 가장 나중인 줄의 값.
- `off`는 그 일정 하나만 끈다(이번 주 회의만 쉬는 경우에 다음 주 표시가 사라지지 않게). 이름 전체를 그만 보려면 [빼기].
- 전에 그 이름으로 보고를 쓴 적이 있으면(일정에 이어진 보고가 있는 이름) 기억이 없어도 `on`으로 본다. 단 그 이름에 `skip` 결정이 더 나중이면 `skip`.

### 4-3. 누를 때 저장

| 누른 것 | 저장 |
| --- | --- |
| 메뉴·일정 창 [보고할 일정] 켬 / [보고할까요?] | 줄 `state=on, decided_by=user, decided_at=지금` |
| [보고할 일정] 끔 | 줄 `state=off, decided_by=user, decided_at=지금` |
| ⋯ [빼기] | 줄 `state=skip, decided_by=user, decided_at=지금` |
| 이름 기억으로 저절로 □가 된 일정을 화면이 처음 봄 | 줄 `state=on, decided_by=rule`(이미 줄이 있으면 넣지 않음) |
| 보고 저장([결과 남기기]·[보고 쓰기]) | 보고 줄에 `google_calendar_id`·`google_event_id` |

- 줄이 있으면 고치고(PATCH), 없으면 넣는다(POST). 두 기기가 동시에 넣어 하나뿐 검사에 걸리면 다시 읽고 고친다. '있으면 고치기'를 한 번에 하는 넣기(merge-duplicates)는 쓰지 못한다 — `workspace_id`·`google_event_id`를 고칠 권한이 없기 때문이다.
- 저절로 켜진 줄(`rule`)을 끄거나 뺄 때는 `state`와 `decided_by=user`를 같이 보낸다(`rule`은 `on`만 되는 검사).
- 제목 사본은 제어 글자(줄바꿈·탭)를 빈칸으로 바꾸고 300자에서 잘라 넣는다. 빈 제목은 화면이 이미 쓰는 '(제목 없음)'을 넣는다.
- 저장은 모두 서버. 기기 한 곳 저장은 쓰지 않는다.

### 4-4. 안 쓴 보고(③)

`state = on`이고 `event_day`가 어제보다 앞이며(지나고 하루가 지남) 그 일정 id에 이어진 보고가 없는 줄. 개수와 목록 모두 이 표와 이미 읽어 둔 보고 목록으로 계산한다(Google 호출 없음).

### 4-5. 사본 맞추기·사라진 일정

- 화면이 Google 일정 범위를 읽을 때, 줄의 제목·날짜·시각·캘린더 id가 일정과 다르면 그 칸만 고친다(`decided_at`은 그대로).
- 다 읽은 범위 안 날짜의 줄인데 그 일정이 없으면(다른 곳에서 지운 일정) 줄을 지운다. Web2에서 일정을 지울 때도 같이 지운다.
- 이어진 보고는 지우지 않는다(보고는 기록이다). 일정이 사라진 보고는 연결 칸이 남아도 화면이 '일정 없음'으로 다룬다.

## 5. 기존 보고 연결 채우기(데이터 변경은 따로)

기존 보고는 '같은 날·같은 이름'인 일정이 있으면 연결을 채운다(보고 내용은 그대로, 빈 연결 칸만 채움). **이 단계는 대상 수만 센다.** 데이터 변경은 커맨드센터가 숫자를 확인한 뒤 따로 한다.

일정 원본은 Google에 있어 DB만으로는 모든 일정을 알 수 없다. DB가 아는 일정은 사업영역에 이어진 일정(`app_project_milestones`의 Google 연결 행)뿐이다. 그래서 길이 둘이다.

- **가. DB만으로 채울 수 있는 것**: 사업영역 주요 일정 행과 같은 날·같은 이름인 보고. 아래 SQL이 센다.
- **나. 나머지**: 화면이 그달 Google 일정을 읽었을 때, 그달의 연결 없는 보고 중 같은 날·같은 이름 일정이 정확히 하나이고 그 일정에 맞는 보고도 정확히 하나일 때만 연결 칸을 채운다(화면 PR C에서, 커맨드센터 확인 뒤 켬).

읽기 전용 확인 SQL(select만, 개수만 나온다 — 제목·이름은 나오지 않는다). 사업 보고 칸 migration 적용 뒤 SQL Editor 새 창에서 실행한다.

```sql
with reports as (
  select m.id, m.workspace_id,
         (m.meeting_at at time zone 'Asia/Seoul')::date as day,
         lower(regexp_replace(coalesce(nullif(btrim(m.series_name), ''), m.title, ''), '\s+', '', 'g')) as name_key
  from public.app_meetings m
  where m.deleted_at is null and m.google_event_id is null and m.meeting_at is not null
), events as (
  select distinct s.workspace_id, ms.google_event_id,
         (ms.start_at at time zone 'Asia/Seoul')::date as day,
         lower(regexp_replace(coalesce(ms.title, ''), '\s+', '', 'g')) as name_key
  from public.app_project_milestones ms
  join public.app_spaces s on s.id = ms.project_id
  where ms.google_event_id is not null and ms.start_at is not null
), pairs as (
  select r.id as report_id, r.workspace_id, e.google_event_id
  from reports r
  join events e on e.workspace_id = r.workspace_id and e.day = r.day and e.name_key = r.name_key
  where r.name_key <> ''
), per_report as (
  select report_id, count(distinct google_event_id) as n from pairs group by report_id
), per_event as (
  select workspace_id, google_event_id, count(distinct report_id) as n from pairs group by workspace_id, google_event_id
)
select '연결 없는 보고(휴지통 제외)' as item, count(*)::text as value from reports
union all select '같은 날·같은 이름 일정이 있는 보고', count(*)::text from per_report
union all select '그중 일정이 정확히 하나인 보고', count(*)::text from per_report where n = 1
union all select '그중 일정이 둘 이상인 보고(손으로 확인)', count(*)::text from per_report where n > 1
union all select '보고가 둘 이상 맞는 일정(손으로 확인)', count(*)::text from per_event where n > 1
union all select '이미 연결된 보고', count(*)::text from public.app_meetings where deleted_at is null and google_event_id is not null;
```

채우는 SQL은 이 문서에 두지 않는다(운영 데이터 변경). 숫자를 본 뒤 커맨드센터가 '정확히 하나 ↔ 정확히 하나'인 짝만 채우는 SQL을 따로 준비한다.

## 6. 화면 PR 나눔 계획(DB 적용 뒤, 앞뒤로 줄 세움)

| PR | 범위 | 주로 만지는 파일 | 요청 번호 |
| --- | --- | --- | --- |
| A | 규칙 모듈·읽고 쓰는 길 + 일정 메뉴·일정 창 [보고할 일정] 켜고 끄기 + [결과 남기기]로 쓴 보고에 연결 저장 | 새 `report-plan-model.mjs`·`report-plan-data.js`, `calendar-row-menu.mjs`, `calendar-context-menu.js`, `calendar-interactions-v2.js`, `team.js`(쓰기 창 저장) | ①·④ 일부 |
| B | 일정 달력 ✓·□(월·주·목록·그날 창·홈 오늘 일정 줄), 누르면 보고 열기·쓰기 창 | `calendar-month-view.js`, `calendar-week-*.js`, `calendar-list-view.js`, `calendar-day-*.js`, `home-day-*` | ④ |
| C | 사업 보고 달력 ●·□·점선 □, 그날 목록 [보고 쓰기]·[보고할까요?]·⋯ [빼기], 저절로 골라 주기, '안 쓴 보고 n ›', 기존 보고 연결 채우기(나) | `report-views.js`, `report-calendar.mjs`, `team.js`(달력) | ②·③·④ |
| D | [보고 쓰기] 창에 그 시각 사진 미리 묶기, 창 먼저 닫고 뒤에서 올리기 | `time-photos.js`, `report-photos*.js`, `team.js`(쓰기 창) | ⑤ |

- A → B·C → D 순서. B와 C는 만지는 파일이 달라 나란히 갈 수 있다. `team.js`를 만지는 A·C·D는 앞뒤로 세운다.
- 지금 도는 다른 세션과 겹치는 파일: `team.js`(달력)·`report-views.js`, `home-day-*`, `calendar-context-menu.js`, 메뉴 부품. 그 세션들이 끝난 뒤에 띄운다.
- 화면 PR마다 PC(1280)·폰(412) 화면 사진과 브라우저 E2E를 붙인다. 할 일의 □(굵은 글자, 배경 없음)와 일정의 □(색 막대 안)가 헷갈리지 않는지 B의 사진으로 확인한다.
- 화면은 새 표·새 칸이 없을 때(적용 전·되돌린 뒤) 표시 없이 지금 그대로 동작해야 한다.

## 7. 적용 순서와 되돌리기

1. `20261111020000_report_plan_event_link` — 승인형 workflow로 시험 적용(dry-run) → 적용(apply). 새 표(빈 표)와 사업 보고 표의 빈 칸 두 개가 생긴다. 화면은 아직 쓰지 않는다.
2. 5절 확인 SQL로 숫자 확인(선택).
3. 화면 PR A부터.

짝 파일: `docs/20261111020000_report_plan_event_link.{precheck,snapshot,postcheck,rollback,preserve}.sql`, `.summary.md`. DB 시험: `tests/auth-handoff/report-plan-event-link-db.test.mjs`(5절 확인 SQL도 가짜 데이터로 돌려 본다).

되돌리기: 짝 rollback(SQL Editor 경로 전용 — 새 표 지우기는 workflow rollback 모드 밖)이 새 표·새 칸·검사·색인·기록만 지운다. 일정에 이어진 보고나 표시 줄이 하나라도 있으면 멈춘다(지워서 통과시키지 않는다). 그때는 preserve SQL로 값을 보관하고 화면을 되돌린 뒤, 값을 비우는 일은 커맨드센터가 따로 승인한 SQL로 한다. 일정·보고 원본은 지우지 않는다. 자동으로 실행되지 않는다.

## 8. 남은 결정·위험

- '끔'은 그 일정만, '빼기'는 그 이름 전체로 정했다(4-2). 화면 PR C의 사진에서 다르게 느껴지면 규칙 모듈만 바꾸면 된다(DB는 그대로).
- 제목 사본은 300자에서 자른다. 그보다 긴 제목은 앞 300자로 같은 이름을 가린다.
- 다른 곳(Google 앱)에서 제목·날짜를 바꾼 일정은 Web2가 그 범위를 다시 읽기 전까지 '안 쓴 보고' 줄에 옛 제목·날짜로 보일 수 있다.
- 기존 보고 연결 채우기(5절 가·나)는 숫자 확인 뒤 정한다.

## 9. 화면 PR C(S58-10)에서 정한 것

사업 보고 달력(`app/report-calendar-plan.mjs` 규칙 · `app/report-calendar-plans.js` 읽기·저장 잇기 · `app/report-views.js` 그리기)이 4절을 따르면서 화면에서 더 정한 것이다. DB는 그대로다.

- **표시가 나오는 곳**: 칸의 점(폰 — 3개까지, 넘치면 종류마다 하나씩은 보이게), 칸 안 줄(PC — 칸 4줄 규칙에 보고와 합쳐 센다), 그날 목록, '+n' 그날 창, '안 쓴 보고' 목록. 보고와 보고할 일정은 시각 순으로 섞는다(종일 일정 맨 위, 같은 시각이면 보고 먼저).
- **칸 칩·사업영역 칩**: 보고에만 걸린다. 보고할 일정은 아직 칸·사업영역이 없어 어느 칩에서나 보인다. 회의명 거르기만 같은 이름 열쇠로 건다.
- **⋯ 메뉴**: □ 줄은 [보고할 일정 ✓](누르면 이 일정만 끔 — 일정 메뉴와 같은 글자)·[빼기], 점선 □ 줄은 [빼기]. PC 우클릭은 같은 메뉴(사이트 공통 우클릭), 폰은 ⋯만(길게 누르기 메뉴는 사이트 공통 규칙대로 두지 않음).
- **[빼기]와 저절로 켜진 줄**: [빼기]를 저장한 뒤 같은 이름의 저절로 켜진 줄(`decided_by = rule`, `state = on`, 이어진 보고 없음)을 같이 지운다. 그 줄은 이름 기억을 옮겨 적은 것뿐이라, 남겨 두면 뺀 뒤에도 □가 남기 때문이다. 사람이 켠 줄·보고를 쓴 일정의 줄은 그대로 둔다.
- **[보고 쓰기]**: 일정 창 [결과 남기기]와 같은 쓰기 창을 같은 값 모양으로 연다(제목·시각·장소·일정 id). Google을 다시 읽지 않으므로 줄 사본만 있는 일정(지난달·Google 연결 없음)에서도 열린다. 장소는 이 달 일정을 읽어 둔 때만 채운다.
- **'안 쓴 보고 n'**: 달력 보기 맨 위 한 줄(접는 줄 — 누르면 그 자리에서 목록). 회의명 거르기는 걸지 않는다(알림). 목록·사진 보기에는 아직 두지 않았다.
- **Google 일정 읽기**: 줄을 읽을 수 있는 서버에서만, 보이는 달(서울 기준 한 달)을 한 번 읽고 5분 동안 메모리에 둔다(기기 저장 없음). 일정 화면에서 일정이 바뀌면 다음에 그릴 때 다시 읽는다. 그릴 것이 같으면 달력을 다시 그리지 않는다.
- **하지 않은 것 — 사라진 일정의 줄 지우기(4-5 둘째 줄)**: 일정 읽기는 캘린더마다 250건까지이고 고른 캘린더만 읽는다. '읽은 범위에 안 보임'이 '지워짐'이라는 보장이 없어(캘린더 선택을 끄기만 해도 안 보인다) 화면이 저절로 지우지 않는다. 지워진 일정의 □는 ⋯ [보고할 일정 ✓]로 끈다. 저절로 지우려면 '다 읽었다'를 서버가 알려 주는 길이 먼저 필요하다(결정 대기).
- **하지 않은 것 — 기존 보고 연결 채우기(5절)**: 이 PR은 데이터를 고치지 않는다. 그래서 일정에서 열지 않고 [+]로 쓴 보고(연결 칸 빈 것)는 같은 날·같은 이름이어도 그 일정의 □가 ●로 바뀌지 않는다. 5절 가(SQL)·나(화면이 '정확히 하나 ↔ 정확히 하나'일 때 잇기)를 정해야 없어진다(결정 대기).
