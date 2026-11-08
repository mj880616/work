# 기록 하나로 설계 (ORG-기록하나로 · BIZ-기록하나로)

📱 폰 가능. 이 문서는 설계만 한다. 앱 코드·DB·Edge·권한 변경 없음. DB는 아래 5절 단계마다 따로 PR을 만들고 정지 지점(AGENTS.md 6·7절)을 둔다.

- 작성: 2026-11-09, Claude Code 웹(작업 세션 S54-22). 기준 main `73f675c`(#2163).
- 시안: 조직 [mockups/org-record-one.html](mockups/org-record-one.html)(#2163, main). 사업 `docs/design/mockups/biz-record-one.html`(#2164, 아직 merge 전 — 그 PR 내용 기준으로 적음).
- 앞 설계(이 문서가 대체하는 부분이 있음): [weekly-menu-pairing.md](weekly-menu-pairing.md)(주 × 조직 × 줄 표 `app_weekly_org_lines`, 제안 줄), [weekly-one-flow.md](weekly-one-flow.md), [project-into-report.md](project-into-report.md), [org-dispute-stage.md](org-dispute-stage.md), [journal-memorable.md](journal-memorable.md), 시안 [mockups/journal-week-tables.html](mockups/journal-week-tables.html)(JOURNAL-이번주보고표), [mockups/weekly-detail-report.html](mockups/weekly-detail-report.html)(WEEKLY-상세보고넣기).
- 표기: **[사실]** 코드·migration에서 확인(파일:줄) / **[결정]** 이 문서가 정함 / **[추정]** 운영 DB를 보지 못해 추정(웹 세션이라 production 조회 없음 — DB PR의 사전 확인 SQL에서 확인). 예시 이름은 모두 가짜("A 지부", "가상 연구").

---

## 0. 한 줄 요약

**쓰는 곳은 '기록' 하나, 보고 표는 그 기록을 보여 주는 창.**
- 조직: 조직마다 '날짜 + 한 줄' 기록 하나(기존 `app_suborganization_updates`를 넓혀 씀). 주간보고 4. 조직보고 = 그 주(월~일) 날짜의 기록 줄. 3. 2) 투쟁 사업장 현황 = 같은 기록의 최근 줄.
- 사업: 사업(세부 과제)마다 기록(새 표 `app_business_records` + 사업 보고는 복사하지 않고 함께 보여 줌) · '지금 상황'과 담당(새 표 `app_business_now`, 주별 이력). 2. 1) 사업요약표 = 지금 상황 + 담당, 2. 2) 주요 사업·회의결과 = 그 주 사업 기록 줄.
- 두 쪽 공통: '보고용으로 수정'·'이번 보고에서 빼기'·'한 줄만 ↔ 상세 포함' 표시는 새 표 하나(`app_report_line_marks`)에 둔다. 원래 기록은 바꾸지 않는다.
- 없어지는 것: 주별로 따로 저장하는 조직 줄·제안 줄, 조직 상세 [현황 표] 쓰기, 지난주 한글 파일 바탕 깔기, 칸 아래 제안 다섯 종류. 옛 자료는 지우지 않는다.

---

## 1. 지금 구조 지도 (사실)

### 1-1. 조직(ORG) — 같은 사실이 다섯 곳

| # | 저장 자리 | 만든 곳 | 쓰는 곳 | 읽는 곳 |
| --- | --- | --- | --- | --- |
| ① 조직 기록 | `app_suborganization_updates`(id, organization_id, raw_text, detail_text, occurred_at, created_by, doc jsonb). 만든 SQL은 저장소에 없음(읽생기와 같은 DB). 정책 `task12a_owner_all` = `private.app_is_owner_organization(organization_id)`(`20260925084844_task12a_sole_owner_db.sql`:179). `doc` 칸은 `20261023233000_ed_format_columns.sql`:71 | — | `app/quick-save.js`:10 `saveOrganizationUpdate` → 저장 뒤 `suggestOrgWeek('org_update')` / 조직 상세 넣기·고치기·지우기 `app/workplace-detail.js`:302·243-252·196 / 홈 업데이트 조직 하나 `app/update-places.js`:158 / 통화·텔레그램 [조직 연결] `app/feed-data.js`:248-257(`feed-link.js`:53) | 조직 상세 `workplace-detail.js`:124·282, 목록 마지막 날짜 `suborganizations.js`:102, 주간 정리 그 주 기록 `journal-data.js`:255-266(4. 1) 대체 길 `journal-weekly.js`:355-366), 원장 자동 기록 `ai-assist/handler.ts`:1848-1860, 할 일 레이더 :1293, 일정 제목·겹침·회의 전 자료 :3315·3542·4183, 검색 RPC `search_records`·`search_attachment_text`·`record_overlap`·`ask_web2`, `drive-summary/core.mjs`:297 |
| ② 조직 상세 [현황 표] | `app_org_status_rows`(day, end_day, body 1~200자, sort_order, source ai/user, evidence) — `20261030234000_org_status_rows.sql`, `20261104201500_org_status_rows_end_day.sql`. 정책 workspace owner, 조직당 30줄 트리거 | — | `app/org-status-table.js`:150-163(고치기·지우기·넣기 → `status_row` 제안) | 상세 소탭 `workplace-detail.js`:48, `org-status-table.js`:29-41, 한글 3. 2) 대체 길 `journal-hwpx.js`:481 |
| ③ 주별 조직보고 줄 | `app_weekly_org_lines`(week_start 월요일 검사, organization_id, day, end_day, body, sort_order, **state suggested/in/dropped**, origin user/plain/ai/last_week, **edited**, source_*_ids, source_hash) — `20261104211500_weekly_org_lines.sql`:41. 정책 workspace owner, 지우기 권한 없음, (주 × 조직)당 40줄 | — | `app/weekly-org-lines.js`:38-71·253-329(넣기·빼기·고치기·지난주 가져오기), 서버 `ai-assist/handler.ts`:2992-3068 `runOrgWeekLines` | 담당조직 [전체 표] `org-overview.js`:12·34·119, 홈 [주간 정리] 4. `journal.js`:502·561-601, 한글 `journal-hwpx.js`:161-189·470-489·935 (4. 1) = state in 줄, `weekly-org-lines-model.mjs`:55-66) |
| ④ 줄 아래 제안 | ③의 state=`suggested` 줄 | — | `app/weekly-org-suggest.js`:19-44(차례로 `ai-assist org_week_lines`), :56-83(빠진 기록 찾아 제안 요청, 10개) | ③과 같음 |
| ⑤ 잊지 말기 '소식' | `app_journal_memorable`(#2143, 묶음 #2161에서 merge 대기) | — | #2143 `app/forget-list.js` [조직] → `saveOrganizationUpdate`(①로 감) | 잊지 말기 목록 |
| 상태 칩 | `app_dispute_stages` + `app_suborganization_dispute_stages`(현재 단계 = 가장 나중 이력 줄) — `20261024100000`·`20261024180000` | — | `org-dispute-stage.js`:41-118 | 목록 `suborganizations.js`:56, 상세 `workplace-detail.js`:30, 한글 3. 2) `journal-hwpx.js`:181 |
| 3. 2) 사업장 빼기·순서 | `app_weekly_exec_requests.draft.site_layout{order, hidden}` | — | `journal-hwpx.js`:1460-1497 | `weekly-schedule-rows.mjs`:148-160 |

- **[사실]** 통화·텔레그램에서 조직으로 가는 서버 자동 저장 길은 없다. 화면의 [조직 연결] 상자(`feed-link.js`)를 눌러야 ①에 들어간다.
- **[사실]** ①은 조직 기준 정책(`app_is_owner_organization`), ②③은 작업공간 기준 정책(`app_is_workspace_owner`)이다. 둘 다 "그 작업공간 주인만"이라는 결과는 같다.
- **[사실]** 주 경계 함수가 여러 개다: `journal-data.js`:50-52 `weekStart`(서울 시각, 가장 정식), `weekly-org-lines-model.mjs`:23-36 `mondayOf`, `weekly-org-suggest.js`:52, `business-area-model.mjs`:61, `org-dispute-stage-model.mjs`:96, 서버 `ai-assist/org-week-lines.ts`:40.

### 1-2. 사업(BIZ) — 2. 1)·2. 2)로 들어오는 여섯 갈래

| # | 길 | 저장 자리 | 파일:줄 |
| --- | --- | --- | --- |
| ① | 그 주 처음 열 때 지난주 개인본(없으면 팀 확정본) 한글 파일을 바탕으로 깔기 | `draft.proposed`(바탕 칸 글) | `weekly-flow-cells.js`:126-131 → `journal.js`:533-541 `prepareFlow` → `weekly-base.js`:17-24 `findBase`(자료실 `app_documents` 분류 personal·confirmed), :77 `ensureWeekProposed`, 고르는 규칙 `weekly-feedback.mjs`:50-59. 빈 칸에 앞 주 draft '지난주에서' `weekly-flow-cells.js`:134-165, `weekly-draft-store.js`:600-619 |
| ② | 직접 쓰기(홈 [주간 정리]·사업 보고 '이번 주 주간보고') | `app_weekly_exec_requests.draft`의 `rows`(section summary, 칸 열쇠 `'사업영역›세부 과제'`)·`owners` — `20261023140000`·`20261024001000`, 정책 workspace owner, unique(workspace_id, week_start) | `weekly-draft-store.js`:224 `changeWeekCell`, :243-257 owners, `weekly-summary-table.js`:114 |
| ③ | 칸 아래 제안 다섯 종류 + [넣기][이미 있음][수정해서 넣기][빼기] | `draft.picks` | `weekly-flow-cells.js`:32(TAG)·89-108·262·288-293·383-412·460-490, `weekly-hwpx/draft.mjs`:338-372, [AI 제안] = `ai-assist weekly_line` |
| ④ | 사업 보고 표 칸 아래 그 주 보고 제목 | 읽기만 | `weekly-summary-table.js`:122-133 `factsHtml`, 재료 :72-76 → `business-area-model.mjs`:66-115 |
| ⑤ | 2. 2) 세부 내용 = 사업 보고 자동 한 줄 | `draft.hand.details`·`details_edits`·picks | `journal-weekly.js`:262-274·314-329, 줄 글 `journal-data.js`:525-529 `meetingLine`, 화면 `weekly-detail-lines.js`:36-62, 내부 정례·'늘 빼기' 제외 `journal-meeting-kinds.js`:26-31(`app_profiles.weekly_hidden_meeting_kinds`) |
| ⑥ | 사업 보고 자체와 업데이트·소식 [사업] | 사업 보고 `app_meetings`(business_area_id → `app_spaces`, next_plan, activity_kind 'oneline' 포함), 업데이트 [사업] = 정리함 메모 + `app_record_links`(`app_basket_confirm_links`), 소식 [사업](#2143) = `app_project_progress_updates`(`quick-save.js`:57 `saveProjectProgress`) | `business-area-fields.js`:21-80, `report-oneline.js`, `report-area-tag.js`, `update-places.js`:140-190, 2. 1) 재료 모으기 `journal-weekly.js`:259·289-310, `journal-data.js`:283-311·437-489, 사업 보고 → 한 줄 `business-area-model.mjs`:77-85 |

- **[사실]** 사업영역·세부 과제는 `app_spaces` 나무(1단 사업영역, 2단 세부 과제)이고 정책은 `owner_id = auth.uid()`(`20260923074619_web2_project_owner_only.sql`:54). 만든 SQL은 저장소에 없다(읽생기와 공유 DB).
- **[사실]** `app_project_progress_updates`는 정책 4개가 운영에만 있고(`20261023232000_project_records_policies_authenticated.sql`), 지금 앱에서 쓰는 곳은 #2143이 처음이다(그전엔 `saveProjectProgress`를 부르는 곳 없음).
- **[사실]** 한글 파일의 2. 2) 세부 내용은 지금 비운다(`weekly-hwpx/delta.mjs`:108 `details: []`, `journal-hwpx.js`:855). 그리는 코드는 `weekly-hwpx/report.mjs`:394-414에 있다.
- **[사실]** 사업 보고 화면의 2) 목록은 `draft.hand`를 읽지 않아, 홈에서 뺀 줄이 사업 보고 화면에는 그대로 보인다(두 화면 불일치 — 이 설계로 함께 사라짐).
- **[사실]** 원장 자동 기록(`ai-assist/handler.ts`:1812-1870)은 `app_notes`·`app_meetings`·조직 기록·`app_project_progress_updates`를 읽고 draft는 읽지 않는다. 환류 학습(`weekly_review`·`weekly_line`, :4583-4712)은 draft의 feedback·rules·picks만 읽는다.

---

## 2. 새 구조

### 2-1. 원칙 [결정]

1. 사실은 한 곳에만 쓴다: 조직 = 조직 기록, 사업 = 사업 기록(+ 사업 보고 원본), 사업의 지금 상황·담당 = 사업 지금 상황 표.
2. 보고 표는 저장하지 않는다. 그 주 날짜로 기록을 골라 보여 준다. 보고에만 다른 것(보고용 글·빼기·상세 여부)은 **표시 표 하나**에 '그 주 × 그 줄'로 둔다.
3. AI는 표 안에 제안하지 않는다. 통화·텔레그램에서 조직·사업 소식을 뽑아 잊지 말기 '소식'까지만 올린다. 명진이 [조직]·[사업]을 눌러야 기록이 된다.
4. 같은 창 부품 하나(`app/record-window.js` + 순수 규칙 `app/record-window-model.mjs`)를 담당조직 전체 표·업무일지 이번 주 보고·홈 주간 정리·사업 보고 '이번 주 주간보고'가 함께 쓴다(UI 한 영역에 상태 주인 하나·그리는 곳 하나, AGENTS.md 5절).
5. 권한: 새 표·새 열 모두 기존 owner 정책 방식 그대로. anon·PUBLIC 권한 없음, 정책을 넓히지 않음, RTW 표 손대지 않음.

### 2-2. 조직 기록 — 기존 `app_suborganization_updates` 넓히기 [결정]

새 표를 만들지 않는 이유: 이 표를 이미 원장 자동 기록·검색·AI 묻기·겹침·회의 전 자료·드라이브 요약 등 열 군데 넘게 읽는다. 새 표로 옮기면 그 길을 모두 고쳐야 하고, 넓히면 읽는 길은 그대로 새 자료까지 본다.

더하는 열(모두 null 허용, 기존 행 영향 없음):

| 열 | 형 | 제약 | 뜻 |
| --- | --- | --- | --- |
| `end_day` | date | null 또는 ≥ 서울 날짜(occurred_at) | 기간 기록(예: 찬반투표 11.2~12.5). 현황 표 `end_day`를 옮겨 옴 |
| `source_kind` | text | null 또는 `user`·`update`·`feed`·`memorable`·`status_row`·`weekly_line` | 어디서 넣었나. null = 옛 행(직접 쓰기로 봄) |
| `source_id` | uuid | null 허용 | 원래 줄 번호(통화·텔레그램 줄, 잊지 말기 줄, 옮긴 현황 표 줄·주별 줄) |

- 인덱스: `unique (organization_id, source_kind, source_id) where source_id is not null` — 같은 원래 줄을 두 번 넣지 않게(옮기기를 다시 돌려도 안전). 주 창 읽기용 `(organization_id, occurred_at)` 인덱스는 사전 확인에서 있는지 보고 없으면 더한다.
- 날짜: 기존 `occurred_at`(timestamptz)를 그대로 '기록 날짜'로 쓴다. 화면의 날짜 고르기는 서울 날짜 → `YYYY-MM-DDT12:00:00+09:00`로 저장(날짜 경계 흔들림 없게).
- 정책·권한: 기존 정책 `task12a_owner_all`과 표 권한을 바꾸지 않는다. **[추정]** 표 권한이 칸 단위가 아니라면 새 열도 같은 정책으로 바로 쓸 수 있다. 칸 단위라면 새 세 열만 authenticated에 insert·update를 더한다(사전 확인 SQL로 판정, 다른 칸·역할 권한은 늘리지 않음).
- 검사 트리거(새, `private.app_suborganization_updates_source_guard`, security invoker): `source_kind`가 `feed`·`memorable`이면 그 원래 줄이 같은 작업공간 것인지 확인. 옮긴 종류(`status_row`·`weekly_line`)는 로그인 사용자가 새로 넣지 못하게 막는다(옮기기 SQL만 넣음).
- **[추정]** 이 표에 `workspace_id` 열이 있는지 운영에서 확인 필요(시험 가짜 표에는 있음, `tests/auth-handoff/search-records.test.mjs`:41). 없으면 작업공간은 조직을 거쳐 판정한다(지금과 같음).

### 2-3. 사업 기록 — 새 표 `app_business_records` [결정]

`app_project_progress_updates`를 넓히지 않는 이유: 정책 4개가 저장소에 없고 공간 권한 함수(읽생기와 함께 쓰는 길)에 기대며, 옛 프로젝트 구조용이다. 깨끗한 작업공간 owner 표를 새로 둔다.

| 열 | 형 | 제약 |
| --- | --- | --- |
| `id` | uuid PK | default gen_random_uuid() |
| `workspace_id` | uuid NN → `app_workspaces` on delete cascade | 고칠 수 없음 |
| `space_id` | uuid NN → `app_spaces` on delete cascade | 같은 작업공간 사업인지 트리거 검사(`private.app_space_in_workspace`), 고칠 수 없음 |
| `day` | date NN | 서울 날짜 |
| `end_day` | date | null 또는 ≥ day |
| `body` | text NN | 1~300자, 앞뒤 공백·제어문자 없음 |
| `source_kind` | text NN | `user`·`update`·`feed`·`memorable`·`progress` |
| `source_id` | uuid | `unique (workspace_id, source_kind, source_id) where source_id is not null` |
| `created_by` | uuid | default auth.uid() |
| `created_at`·`updated_at` | timestamptz | updated_at = 서버 시각(트리거) |

- 정책 하나: `business_records_owner_all for all to authenticated using/with check private.app_is_workspace_owner(workspace_id)`. 표 권한: authenticated select·delete + 칸 단위 insert(space_id, day, end_day, body, source_kind, source_id, workspace_id)·update(day, end_day, body). anon·PUBLIC 없음.
- 인덱스: `(workspace_id, space_id, day)`, `(workspace_id, day)`.
- 트리거 `private.app_business_records_guard`: 사업·원래 줄이 같은 작업공간인지, `progress`는 옮기기 SQL만(로그인 사용자 넣기 거절), 사업당 하루 50줄 상한, updated_at.
- **사업 보고는 복사하지 않는다** [결정]: 사업 보고(`app_meetings`, business_area_id 있음)는 창이 읽을 때 '사업 보고 줄'로 함께 섞어 보인다(날짜 = 보고 날짜, 글 = 지금의 `business-area-model.mjs` 한 줄 규칙). 그래서 사업 보고를 고치면 기록 줄도 따라 바뀌고, 두 벌이 어긋나지 않는다. 사업 기록 화면에서 이 줄의 ⋯는 [보고 열기]뿐(고치기는 사업 보고에서).
- 업데이트 [사업]: 지금 정리함 메모 + `app_record_links` 확정 연결은 그대로 두고(정리함은 원본 메모 자리), 같은 저장에서 사업 기록 한 줄(`source_kind='update'`, `source_id`=메모 id)을 더한다. 확정 연결 RPC는 바꾸지 않는다.

### 2-4. 사업 지금 상황·담당 — 새 표 `app_business_now` [결정]

| 열 | 형 | 제약 |
| --- | --- | --- |
| `id` | uuid PK | |
| `workspace_id` | uuid NN | 고칠 수 없음 |
| `space_id` | uuid NN → `app_spaces` | 같은 작업공간 검사 |
| `week_start` | date NN | 월요일(isodow=1) |
| `body` | text NN | 0~1000자(빈 칸 허용 = '—') |
| `owner_text` | text NN | 0~100자(담당 이름 글자) |
| `updated_at` | timestamptz | 서버 시각 |

- `unique (workspace_id, space_id, week_start)`. **그 주의 지금 상황 = week_start ≤ 그 주인 가장 나중 행** [결정]. 이번 주에 고치면 이번 주 행을 만들거나 고친다(지난 주 행은 그대로) → "계속 이어 씀"이면서 지난주 보고 표는 그때 글 그대로 보인다(상태 칩 이력과 같은 방식).
- `app_spaces`에 열을 더하지 않는 이유: 그 표는 만든 SQL이 저장소에 없고 읽생기와 같은 DB라 모양을 바꾸지 않는다.
- 정책·권한·인덱스는 2-3과 같은 방식(`(workspace_id, space_id, week_start desc)`).
- 담당은 사람 계정이 아니라 글자다(지금 `draft.owners`와 같음, 협업 구조를 새로 쓰지 않음 — AGENTS.md 5절).

### 2-5. 보고용 표시 — 새 표 `app_report_line_marks` (조직·사업 공통) [결정]

| 열 | 형 | 제약 |
| --- | --- | --- |
| `id` | uuid PK | |
| `workspace_id` | uuid NN | |
| `week_start` | date NN | 월요일 |
| `section` | text NN | `org`(4. 1)) · `site`(3. 2)) · `biz_summary`(2. 1)) · `biz_detail`(2. 2)) |
| `ref_kind` | text NN | `org_update` · `biz_record` · `meeting` · `space` |
| `ref_id` | uuid NN | 그 기록·보고·사업 번호 |
| `report_body` | text | null = 원래 글 그대로 / 글 = 이번 보고에만 쓰는 글(1~1000자) → 줄 끝 작은 ✓ |
| `dropped` | boolean NN default false | 이번 보고에서 빼기 → 칸 아래 '뺀 줄 n ⌄' |
| `detail` | text | null = 기본 / `oneline` / `full`(2. 2) 사업 보고만) |
| `updated_at` | timestamptz | 서버 시각 |

- `unique (workspace_id, week_start, section, ref_kind, ref_id)`. 표시가 모두 기본값으로 돌아가면 행을 지운다(표시만 지우는 것이라 기록은 그대로). 그래서 authenticated에 delete를 준다.
- 트리거 `private.app_report_line_marks_guard`: `ref_id`가 같은 작업공간 것인지(조직 기록 → 조직 → 작업공간, 사업 기록·사업 보고 → workspace_id, 사업 → `app_space_in_workspace`), 주 × 작업공간 800행 상한, updated_at.
- 왜 draft jsonb에 두지 않나: draft는 200KiB 한 덩어리를 통째로 PATCH해 여러 화면이 동시에 고치면 부딪친다. 조직보고 표는 담당조직·업무일지·홈 세 곳에서 고친다 → 줄 하나 = 행 하나가 안전하다. 3. 2) 사업장 단위 빼기·순서(`draft.site_layout`)는 그대로 둔다(조직 단위라 겹치지 않음).
- '보고용으로 수정'은 **그 주 보고에만** 쓰인다. 원래 기록 글이 나중에 바뀌어도 보고용 글은 그대로이고, 표시 옆 ⋯ [원래 글로]로 지운다.

### 2-6. 주 경계 [결정]

- 주 = 월요일 00:00 ~ 일요일 24:00, Asia/Seoul. 창의 기준 함수는 `journal-data.js` `weekStart`(서울 시각) 하나로 맞춘다. 새 순수 규칙 `record-window-model.mjs`는 `weekStart`를 받아 쓰고 새로 계산하지 않는다(다른 `weekOf` 정리는 범위 밖, 10절).
- 기간 기록(end_day 있음)은 **시작일이 그 주인 경우만** 그 주 창에 나온다 [결정, 질문 Q2]. 기간 안에 있다는 것은 3. 2) 현황(최근 줄)과 상태 칩이 보여 준다.
- DB 조회: 조직 기록은 `occurred_at >= 월요일T00:00+09:00 and occurred_at < 다음 월요일T00:00+09:00`, 사업 기록은 `day between 월 and 일`.

### 2-7. 창의 규칙(순수 규칙, `record-window-model.mjs`)

- 4. 1) 조직 칸: 그 조직의 그 주 기록 줄(날짜 오름차순) − `dropped` 줄, 글은 `report_body ?? raw_text`(줄 앞 `- M.D.` 형식은 지금 보고 형식 그대로). 조직 순서는 주간보고 순서(지금 4. 1) 순서 규칙 그대로), 상태(쟁의 단계)는 조직 칸 아래 작은 글씨.
- 3. 2) 투쟁 사업장: 쟁의 단계 줄(지금 그대로) + 같은 조직 기록의 **최근 줄**(Q3 추천: 그 주 줄, 없으면 그 주 이전 가장 최근 1줄). 사업장 빼기·순서는 `draft.site_layout` 그대로.
- 2. 1) 사업요약표: 줄 = '사업영역 관리' 목록(활성 `app_spaces` 1·2단). 칸 = 그 주의 `app_business_now.body`(또는 `report_body`) + 담당. 칸 아래 흐린 '이번 주 기록 n'(읽기만, 누르면 펼쳐 보기·누르면 원본 열기).
- 2. 2) 주요 사업·회의결과: 그 주 사업 기록 줄 + 사업 보고 줄을 사업별로 묶음, 활동 없는 사업은 빠짐, 내부 정례·'늘 빼기' 종류는 지금 규칙(`journal-meeting-kinds.js`)대로 제외, 사업 보고에 결과 본문이 있으면 기본 '상세 포함'(`detail` 표시로 한 줄만). 상세는 `(1) ○○ 결과` 소제목 + 본문, 본문 안 번호는 한 단계씩 내림(1.→1)→(1)→①, `docs/hwp-style-map.md`:26-38).

---

## 3. 옛 자료 옮기기·되돌리기

### 3-1. 옮기기 [결정] — 지우지 않고 복사, 다시 돌려도 같은 결과

| 옛 자리 | 옮기는 곳 | 방법 |
| --- | --- | --- |
| `app_org_status_rows` 모든 줄 | 조직 기록 | `occurred_at = day 12:00+09`, `end_day`, `raw_text = body`, `source_kind='status_row'`, `source_id = 원래 id`, `created_at = 원래 created_at`. 같은 조직·같은 날·같은 글의 기록이 이미 있으면 건너뜀 |
| `app_weekly_org_lines` 중 state=`in`이고 원래 기록이 없는 줄(origin user·plain, 또는 source 번호가 비었거나 원래 기록이 지워짐) | 조직 기록 | `occurred_at = coalesce(day, week_start) 12:00+09`, `source_kind='weekly_line'`, 위와 같은 건너뛰기 |
| `app_weekly_org_lines` 중 state=`in`·`edited=true`이고 원래 기록이 하나인 줄 | 표시 표 | 그 주 `section='org'`, `ref = 원래 기록`, `report_body = body` |
| `app_project_progress_updates`(#2143 이후 생긴 [사업] 줄 포함) | 사업 기록 | `source_kind='progress'`, `day = effective_on`, `space_id = project_id`(같은 작업공간 사업일 때만, 아니면 건너뛰고 개수만 보고) |
| `draft.rows`(section summary)·`draft.owners` | 사업 지금 상황 | 화면이 한 번 채움(아래) |

- **도입 전 주 보고 줄 보존** [결정, Q1]: 전환 주(DB·화면 적용 주) **이전** 주는 옛 표(`app_weekly_org_lines` state=in, 옛 draft)를 그대로 읽어 보여 준다(읽기 전용, '옛 보고' 작은 표시). 그래서 옛 주의 조직보고 표·사업요약표는 그때 보고한 글 그대로다. 전환 주부터는 창 규칙만 쓴다. 전환 주는 코드 상수 하나(`RECORD_ONE_FROM`, 화면 PR에서 운영 적용 뒤 정함).
- **원장 자동 기록 중복 막기**: 옮긴 줄(`status_row`·`weekly_line`·`progress`)은 원장 자동 기록 재료에서 뺀다(이미 원장에 같은 사실이 있거나 옛 사본). 원래 `created_at`을 그대로 두고, ai-assist 재료 읽기에 `source_kind` 거르기를 더한다(Edge 배포 정지 지점, 5절 O-6).
- **지금 상황 처음 채우기(BIZ)**: 사업 지금 상황 표가 비어 있는 사업에 한해, 사업 보고 '이번 주 주간보고'나 홈 [주간 정리]를 처음 열 때 화면이 한 번 채운다 — ① 가장 최근 팀 확정본 한글 파일의 사업요약표 칸 글(기존 `weekly-base.js` 읽기 재사용), 없으면 ② 그 주 `draft` summary 칸 글, 둘 다 없으면 '—'. 채운 행은 전환 주 `week_start`로 넣는다. 한글 파일은 Drive에 있어 SQL로 읽을 수 없어 화면에서 한다. 사람이 고친 값은 덮지 않는다(행이 이미 있으면 건너뜀).

### 3-2. 되돌리기

- 화면: 각 화면 PR을 되돌리면(revert PR) 옛 화면이 돌아온다. 옛 표를 지우지 않았으므로 옛 화면은 그대로 읽힌다. 단 되돌린 동안 새 주 조직보고 줄은 비게 되고, 옛 화면 4. 1)은 그 주 기록으로 대신 채우는 길(`journal-weekly.js`:355-366)이 이미 있다.
- DB 구조: 새 표 3개 drop, 조직 기록의 새 열 3개·인덱스·트리거 drop(새 열만, 기존 열·정책 그대로). migration마다 rollback SQL·snapshot 짝 파일을 둔다(`docs/ops-db-workflow.md`).
- 옮긴 자료: `source_kind in ('status_row','weekly_line')`인 조직 기록 행, `source_kind='progress'`인 사업 기록 행만 지우는 rollback SQL로 정확히 되돌린다(원래 자료는 그대로 있으므로 손실 없음). 전환 뒤 새로 쓴 기록은 되돌리기에서 지우지 않는다.

---

## 4. 화면별 변경 목록

| 화면 | 지금 | 바뀐 뒤 |
| --- | --- | --- |
| 담당조직 목록 | 상태 칩·마지막 기록 날짜 | 그대로(마지막 날짜는 옮긴 기록 포함) |
| 담당조직 [전체 표] '이번 주 조직보고' (`org-overview.js`) | 주별 줄 + 제안 + 지난주 가져오기 + '+ 줄' | 창 부품: 조직 칸 = 그 주 기록 줄 + [+ 쓰기](그 조직 기록에 쌓임, 날짜 = 오늘, 바꿀 수 있음). 줄 ⋯ = [보고용으로 수정](작은 ✓) · [이번 보고에서 빼기](칸 아래 '뺀 줄 n ⌄'에서 되돌리기) · [기록 열기]. 상태는 조직 칸 아래 작은 글씨 |
| 조직 상세 (`workplace-detail.js`) | [기록]·[현황 표] 두 소탭 | '날짜 \| 기록' 한 표(날짜 내림차순, 최근 n줄 + '지난 기록 n ⌄'). 줄 ⋯ = [수정][삭제][원래 통화·글 보기(source 있을 때)]. [+ 쓰기]. [현황 표] 소탭·[AI로 채우기] 삭제(`org-status-table.js` 쓰기 길 삭제, 표 자료는 보존) |
| 업무일지 '이번 주 보고'(JOURNAL-이번주보고표) | 시안만(#2136 merge, 구현 PR 없음) | 왼쪽 = 조직보고 창, 오른쪽 = 사업요약 창을 **붙이기만** 한다(새 저장 없음). 4-1절 |
| 홈 [주간 정리] 2. 1) | 바탕 깔기 + 칸 아래 제안 다섯 종류 + 직접 쓰기 | 사업요약 창: 칸 = 지금 상황(누르면 그 자리 수정 → `app_business_now`), 담당, 흐린 '이번 주 기록 n'. 제안·바탕 깔기 삭제 |
| 홈 [주간 정리] 2. 2) | 사업 보고 자동 한 줄 + `draft.hand` | 주요 사업 창: 그 주 사업 기록 + 사업 보고(상세 포함), 줄 ⋯ = [보고용으로 수정]·[이번 보고에서 빼기]·[한 줄만 ↔ 상세 포함]·[기록 열기], 사업 묶음 아래 [+ 쓰기](사업 기록). 이 종류 늘 빼기는 그대로 |
| 홈 [주간 정리] 3. 2) | 쟁의 단계 + 넣은 줄 또는 현황 표 줄 | 쟁의 단계 + 조직 기록 최근 줄(2-7). 사업장 빼기·순서 그대로 |
| 홈 [주간 정리] 4. | 주별 줄 표 | 조직보고 창(담당조직 전체 표와 같은 부품) |
| 사업 보고 '이번 주 주간보고' (`weekly-summary-table.js`) | 진행·담당 직접 쓰기 + 칸 아래 그 주 보고 제목 + 2) 목록(홈의 빼기를 못 읽음) | 2. 1)·2. 2) 창을 홈과 같은 부품으로(두 화면 불일치 사라짐) |
| 한글 파일 (`journal-hwpx.js`, `weekly-hwpx/*`) | 4. 1) = 넣은 줄, 2. 1) = 바탕 + 고친 칸 + owners, 2. 2) = 비움 | 같은 창 규칙 결과를 그대로 넣음: 4. 1)·3. 2)·2. 1)(지금 상황+담당)·2. 2)(줄 + 상세, `delta.mjs`:108 비움을 창 결과로, 그리기 `report.mjs`:394-414 재사용). 지난 개인본 바탕 깔기는 사업요약 칸에서 삭제(다른 절의 바탕 쓰임은 그대로) |
| 잊지 말기 '소식' [조직]·[사업] (#2143) | [조직] → `saveOrganizationUpdate`(그 뒤 제안 요청), [사업] → `saveProjectProgress` | [조직] → `saveOrganizationUpdate({…, source_kind:'memorable', source_id: 소식 id})`(제안 요청 없음). [사업] → 새 `saveBusinessRecord({space_id, day, body, source_kind:'memorable', source_id})`. 안내 문구 '이번 주 조직보고 제안에 올라가요' → '이번 주 조직보고에 보여요'. #2161 merge 뒤 O-3 PR에서 고침 |
| 통화·텔레그램 [조직 연결] (`feed-data.js`:248) | 조직 기록 넣기 | 같은 길 + `source_kind='feed'`, `source_id`=줄 id → 조직 상세 ⋯ [원래 통화·글 보기] |
| 홈 업데이트 [조직]·[사업] (`update-places.js`) | 조직 하나 → 조직 기록 / 사업 → 정리함 메모 + 확정 연결 | 조직: `source_kind='update'`. 사업: 그대로 + 사업 기록 한 줄 |
| 원장 자동 기록 (`ai-assist` ledger_auto) | 조직 기록·사업 보고·옛 진행 기록을 읽음 | 조직 기록(옮긴 줄 제외) + 사업 기록(새 표, `progress` 제외) + 사업 보고. 근거 붙이기·더하기만 규칙 그대로 |
| 환류 학습 (`weekly_review`·`weekly_line`) | draft feedback·rules·picks | 2. 1) 제안이 사라지면 `weekly_line` 쓰임이 없어짐 → B-6에서 삭제. 표시 표의 '보고용으로 수정'은 학습 재료로 쓰지 않는다(이번 설계 범위 밖, 10절) |
| ai-assist `org_week_lines` | 제안 줄 쓰기 | 삭제(O-6, Edge 배포 정지) |

### 4-1. 업무일지 '이번 주 보고'(S54-06 JOURNAL-이번주보고표)와의 관계

- 확인(2026-11-09): 시안 PR #2136은 merge됨, 구현 PR은 열려 있지 않다(`gh api pulls?state=all`로 제목 검색). → 살릴 것/버릴 것 표는 시안 기준.

| 시안 #2136 요소 | 처리 |
| --- | --- |
| 표 두 개(왼쪽 4. 조직보고 \| 오른쪽 2. 사업요약), 폰은 위아래 | 살림 — 이 설계의 조직보고 창·사업요약 창을 그 자리에 붙임 |
| 같은 자료 = `weekly-org-lines.js`·`weekly-flow-cells.js` | 버림 — 창 부품(`record-window.js`)을 읽음 |
| '주간보고 재료'·'그 밖의 기록' 자리 대체 | 살림('그 밖의 기록'은 #2142에서 삭제) |
- 구현 세션이 나중에 생기면 이 설계의 O-3·B-3 뒤에 줄 세운다(창 부품이 먼저 있어야 함).

---

## 5. 단계별 PR 순서와 정지 지점

ORG 먼저, BIZ는 ORG 창 부품을 재사용해 뒤에. 각 DB PR은 ★정지★(작업 세션은 PR까지, 적용은 커맨드센터가 승인형 DB workflow로 시험 적용 → 적용 → 사후 확인).

| 단계 | PR | 내용 | 정지 지점 | 완료 기준 |
| --- | --- | --- | --- | --- |
| O-1 | 설계(이 PR) | 이 문서 | — | 명진 결정 Q1~Q3 |
| O-2 | ★DB★ 조직 기록 넓히기 + 표시 표 | `app_suborganization_updates` 새 열 3·인덱스·검사 트리거, `app_report_line_marks` 새 표(owner 정책·칸 권한·트리거), 짝 파일 5개 | ★DB 적용 정지★ | 시험 적용 통과, 사후 확인: 정책 수·anon 권한 없음·기존 정책 해시 같음, 기존 앱 회귀 없음(열 추가뿐) |
| O-3 | ★DB★ 옛 조직 자료 옮기기 | 3-1 조직 행 복사(멱등, 건너뛰기), 옮긴 개수 보고 SQL | ★DB 적용 정지★ (운영 데이터 변경) | 옮긴 수 = 사전 확인 대상 수 − 건너뛴 수, 다시 돌리면 0건 |
| O-4 | 창 부품 + 조직보고 표 | `record-window-model.mjs`·`record-window.js`, 담당조직 전체 표·홈 4.·업무일지(있으면) 연결, 저장 길에 `source_kind`(조직 상세·업데이트·통화·소식 #2143), 전환 주 상수·옛 주 읽기 전용, release-notes | — | 단위 시험(주 경계·빼기·✓·옛 주), E2E(폰·PC: 쓰기 → 그 주 칸에 보임, 빼기 → 뺀 줄 n, 되돌리기), CI 통과 |
| O-5 | 조직 상세 합치기 | [기록]·[현황 표] → '날짜 \| 기록' 한 표, 현황 표 쓰기·[AI로 채우기] 삭제 | — | E2E 상세, 삭제한 화면 경로 참조 0 |
| O-6 | 한글 파일 + 옛 제안 코드 삭제 | 4. 1)·3. 2) 창 결과, `weekly-org-suggest.js`·`weekly-org-lines.js` 쓰기 길·`quick-save.js` 제안 호출 삭제, ai-assist `org_week_lines` 삭제 + 원장 재료 `source_kind` 거르기 | ★Edge 배포 정지★(ai-assist, 되돌리기 ref 기록) | 한글 파일 시험(4. 1)·3. 2) 줄 같음), 서버 시험, 배포 뒤 401·OPTIONS |
| B-1 | ★DB★ 사업 표 | `app_business_records`·`app_business_now` 새 표, 표시 표 section·ref 값은 O-2에 이미 있음 | ★DB 적용 정지★ | O-2와 같은 사후 확인 |
| B-2 | ★DB★ 옛 사업 진행 기록 옮기기 | `app_project_progress_updates` → 사업 기록(멱등) | ★DB 적용 정지★ | 옮긴 수 보고 |
| B-3 | 2. 1) 사업요약 창 | 지금 상황·담당 쓰기·처음 한 번 채우기, 칸 아래 '이번 주 기록 n', 홈·사업 보고·업무일지 연결, 업데이트·소식 [사업] → 사업 기록 | — | 단위·E2E(이어 씀: 지난주 글이 이번 주에 보임, 이번 주 고쳐도 지난주 그대로) |
| B-4 | 2. 2) 주요 사업 창 + 상세 포함 + 한글 파일 | 사업 기록 + 사업 보고 묶기, [한 줄만 ↔ 상세 포함], `delta.mjs` details 연결, 번호 한 단계씩 | — | 한글 파일 시험(번호 규칙), E2E |
| B-5 | 옛 사업 제안·바탕 깔기 삭제 | `weekly-flow-cells.js` 제안·[넣기]류·바탕 깔기, `draft.hand.details` 쓰기 길, ai-assist `weekly_line` | ★Edge 배포 정지★ | 삭제 경로 참조 0, 시험 통과 |

- 같은 파일을 만지는 단계는 앞뒤로 줄 세운다(O-4 → O-5 → O-6, B-3 → B-4 → B-5; O-4와 B-3은 `journal.js`·`journal-hwpx.js`가 겹쳐 O 다음 B).
- 옛 표(`app_org_status_rows`·`app_weekly_org_lines`·`app_project_progress_updates`·draft 칸)는 이 설계에서 지우지 않는다. 지우는 것은 명진이 따로 요청할 때만.

---

## 6. 명진에게 보일 일상어 3줄

**조직 (ORG-기록하나로)**
- 무엇이 바뀌나: 조직마다 '날짜 + 한 줄' 기록 하나에만 쓰고, 주간보고 조직보고 표는 그 주 날짜의 기록을 그대로 보여 줍니다. 현황 표·주간 줄·제안 줄은 없어지고, 보고에만 다르게 쓰거나 빼는 것은 작은 표시로 남습니다.
- 잘못되면: 옮긴 옛 줄이 두 번 보이거나, 지난주 보고 표 모양이 바뀌어 보일 수 있습니다. 기록 자체는 지워지지 않습니다.
- 되돌리는 방법: 화면은 이전 판으로 되돌리면 옛 표가 그대로 나옵니다(옛 자료를 지우지 않았기 때문). 옮긴 줄은 '옮긴 표시'가 붙어 있어 그 줄만 정확히 지울 수 있습니다.

**사업 (BIZ-기록하나로)**
- 무엇이 바뀌나: 사업마다 기록·'지금 상황'·담당을 한 번만 씁니다. 사업요약표는 지금 상황을 이어 쓰고, 주요 사업·회의결과는 그 주 기록과 사업 보고가 저절로 들어갑니다. 지난주 한글 파일을 깔던 것과 칸 아래 제안 다섯 종류는 없어집니다.
- 잘못되면: 처음 바꾼 주에 지금 상황 칸이 비거나 옛 글로 채워질 수 있고, 활동 없는 사업은 2. 2)에서 빠집니다. 지난 확정본·임시저장은 그대로 남습니다.
- 되돌리는 방법: 화면을 이전 판으로 되돌리면 옛 임시저장 표가 그대로 나옵니다. 새로 만든 사업 표는 지워도 옛 자료에 영향이 없습니다.

---

## 7. 결정이 필요한 것 (추천안 ★)

- **Q1. 이 방식으로 바꾸기 전 주의 보고 표는 어떻게 보일까요?**
  - ★ 그때 넣은 줄 그대로 보여 줌(바꿔 다시 계산하지 않음, 고칠 수 없음)
  - 그 주 기록으로 다시 계산해 보여 줌(옛 보고와 달라질 수 있음)
- **Q2. '11.2~12.5'처럼 기간이 있는 기록은 어느 주 표에 나올까요?**
  - ★ 시작한 주에만 한 번(그 뒤 주에는 3. 2) 투쟁 사업장 현황과 상태 칩이 계속 보여 줌)
  - 기간이 걸친 모든 주에 매번
- **Q3. 3. 2) 투쟁 사업장 현황의 '최근 줄'은 몇 줄일까요?**
  - ★ 그 주 기록 줄 전부, 그 주에 없으면 가장 최근 1줄
  - 언제나 가장 최근 3줄

이 밖의 구조 선택(조직 기록은 기존 자리 넓히기, 사업 기록·지금 상황·표시는 새 자리, 사업 보고는 복사하지 않고 함께 보여 주기)은 기술 판단이라 이 문서가 정했다.

---

## 8. 보안·권한 확인

- 새 표 3개: RLS 켬, 정책 하나 = `private.app_is_workspace_owner(workspace_id)`, anon·PUBLIC 권한 없음, authenticated는 칸 단위 넣기·고치기, 같은 작업공간 검사는 트리거(security invoker, `search_path=''`). 화면이 보낸 작업공간·사업·조직 번호는 트리거·정책이 다시 판정한다(AGENTS.md 3절 3).
- 조직 기록: 기존 정책·권한을 바꾸지 않고 열만 더한다. 옮긴 종류는 로그인 사용자가 만들 수 없다.
- 운영자 전용 기능(통화·텔레그램)은 지금처럼 서버 판정. 이 설계는 소식을 기록으로 옮기는 버튼만 다룬다.
- 외부 입력(통화·텔레그램)에서 기록까지는 늘 명진의 [조직]·[사업] 누름을 거친다(자동 연결 없음).
- RTW 표(`rtw_*`)·`app_spaces`·`app_meetings` 모양은 바꾸지 않는다.

## 9. 남은 위험

- 보고를 보낸 뒤 원래 기록을 고치면 그 주 창의 글도 바뀐다(보고용 글을 쓴 줄은 제외). 보낸 보고의 원본은 자료실 한글 파일(확정본·개인본)이다.
- `app_suborganization_updates`·`app_project_progress_updates`는 만든 SQL이 저장소에 없어 열·권한 모양을 운영 사전 확인으로만 안다(O-2·B-2 사전 확인 SQL에서 맞지 않으면 멈춤).
- 사업 보고를 복사하지 않으므로, 사업 보고를 휴지통에 넣으면 그 주 창에서도 사라진다(의도된 동작).

## 10. 범위 밖 발견사항(고치지 않음)

- 같은 일을 하는 주 경계 함수가 여섯 곳(1-1 끝). 창은 `journal-data.js` `weekStart` 하나만 쓰고, 나머지 정리는 따로.
- 2. 1) [AI 요약] 태그는 채우는 곳이 없어 지금 어디에도 나오지 않는 것으로 보임 [추정] — B-5에서 함께 삭제됨.
- `app_weekly_org_summaries`·`app_suborganization_weekly_reports`는 읽지도 쓰지도 않고 보존만 하는 옛 표.
- 원장 W-3(`draft.issued` 대조) 사본 `_shared/weekly-lines.mjs`를 import하는 함수가 없음.
- '보고용으로 수정' 내용을 환류 학습 재료로 쓸지는 따로 정할 일.
