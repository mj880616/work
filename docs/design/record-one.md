# 기록 하나로 설계 (ORG-기록하나로 · BIZ-기록하나로)

📱 폰 가능. 이 문서는 설계만 한다. 앱 코드·DB·Edge·권한 변경 없음. DB는 아래 5절 단계마다 따로 PR을 만들고 정지 지점(AGENTS.md 6·7절)을 둔다.

- 작성: 2026-11-09, Claude Code 웹(작업 세션 S54-22). 기준 main `73f675c`(#2163).
- 고침: 2026-11-09, Claude Code 웹(작업 세션 S54-24) — 명진 결정(11/09 02:18) 반영: 지난 주 표 = 개인 확정본 사진(2-8), 조직보고 = 지난 3주~앞 2주 창(2-6·2-7), 3. 2) = 3~7줄. 기준 main `e4b436c`.
- 고침: 2026-11-09, Claude Code 웹(작업 세션 S54-25) — 명진 결정(11/09 03:15) 반영: Q-A = 조직보고 창에 그 조직과 연결된 구글 캘린더 일정도 자동으로(2-9, 읽기만), Q-B = 뺀 줄은 다음 주에도 빠짐(2-5), '뺀 줄 n'은 그 주 창 안의 뺀 줄만 셈(2-5·2-7).
- 시안 더: [mockups/biz-report-top.html](mockups/biz-report-top.html)(#2168).
- 시안: 조직 [mockups/org-record-one.html](mockups/org-record-one.html)(#2163, main). 사업 `docs/design/mockups/biz-record-one.html`(#2164, 아직 merge 전 — 그 PR 내용 기준으로 적음).
- 앞 설계(이 문서가 대체하는 부분이 있음): [weekly-menu-pairing.md](weekly-menu-pairing.md)(주 × 조직 × 줄 표 `app_weekly_org_lines`, 제안 줄), [weekly-one-flow.md](weekly-one-flow.md), [project-into-report.md](project-into-report.md), [org-dispute-stage.md](org-dispute-stage.md), [journal-memorable.md](journal-memorable.md), 시안 [mockups/journal-week-tables.html](mockups/journal-week-tables.html)(JOURNAL-이번주보고표), [mockups/weekly-detail-report.html](mockups/weekly-detail-report.html)(WEEKLY-상세보고넣기).
- 표기: **[사실]** 코드·migration에서 확인(파일:줄) / **[결정]** 이 문서가 정함 / **[추정]** 운영 DB를 보지 못해 추정(웹 세션이라 production 조회 없음 — DB PR의 사전 확인 SQL에서 확인). 예시 이름은 모두 가짜("A 지부", "가상 연구").

---

## 0. 한 줄 요약

**쓰는 곳은 '기록' 하나, 보고 표는 그 기록을 보여 주는 창.**
- 조직: 조직마다 '날짜 + 한 줄' 기록 하나(기존 `app_suborganization_updates`를 넓혀 씀). 주간보고 4. 조직보고 = 보고하는 주 기준 **지난 3주 ~ 앞 2주** 창에 걸친 기록 줄 + 그 조직과 연결된 구글 캘린더 일정 줄(작은 '일정', 읽어서 보여 주기만 — 2-9)(합쳐 조직당 최대 7줄, 넘치면 오래된 것부터 접음). 3. 2) 투쟁 사업장 현황 = 같은 창의 기록 **3~7줄**.
- 사업: 사업(세부 과제)마다 기록(새 표 `app_business_records` + 사업 보고는 복사하지 않고 함께 보여 줌) · '지금 상황'과 담당(새 표 `app_business_now`, 주별 이력). 2. 1) 사업요약표 = 지금 상황 + 담당, 2. 2) 주요 사업·회의결과 = 그 주 사업 기록 줄(사업은 긴 창을 쓰지 않음, 2-7).
- 두 쪽 공통: '보고용으로 수정'·'빼기/넣기'·'한 줄만 ↔ 상세 포함' 표시는 새 표 하나(`app_report_line_marks`)에 둔다. 표시는 그 주부터 다음 주로 이어진다(창이 겹치므로 — 한 번 뺀 줄은 다음 주에도 빠짐, 명진 Q-B). '뺀 줄 n'은 그 주 창 안에 들어오는 뺀 줄만 세므로 쌓이지 않는다. 원래 기록·캘린더 일정은 바꾸지 않는다.
- 지난 주 표: [확정](개인 확정본 저장) 때 창 결과를 사진으로 남겨(새 표 `app_report_snapshots`) 그대로 보여 준다. 확정 뒤 새로 쓴 그 주 창의 기록은 같은 표에 흐린 글씨로 따로(2-8).
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
2. 보고 표는 쓰는 곳이 아니다. 창 기간(2-6)으로 기록을 골라 보여 준다. 보고에만 다른 것(보고용 글·빼기·넣기·상세 여부)은 **표시 표 하나**에 '그 주부터 × 그 줄'로 둔다. 저장하는 것은 [확정] 때 한 번 찍는 사진(2-8)뿐이고, 사진은 다시 고쳐 쓰는 곳이 아니다(새 판 확정 때 통째로 바뀜).
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
- **[추정]** 앱 코드는 이 표의 `created_at`을 읽지 않는다(select 목록에 없음). '확정 뒤 추가'(2-8)는 줄이 언제 생겼는지를 봐야 하므로, 사전 확인에서 `created_at`(서버 기본값 now())이 없으면 O-2에서 `created_at timestamptz default now()`를 더한다(기존 행은 null = '확정 전부터 있던 줄'로 봄). 있으면 그대로 쓴다.
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
| `week_start` | date NN | 월요일. **이 주부터** 적용 |
| `section` | text NN | `org`(4. 1)) · `site`(3. 2)) · `biz_summary`(2. 1)) · `biz_detail`(2. 2)) |
| `ref_kind` | text NN | `org_update` · `biz_record` · `meeting` · `space` · `event`(구글 캘린더 일정, 2-9 — 명진 Q-A) |
| `ref_key` | text NN | 1~200자. uuid 종류는 uuid 모양만 받음(트리거). `event`는 구글 일정 id(반복 일정은 회차별 id, `singleEvents=true`로 읽으므로 회차마다 다름) — `^[A-Za-z0-9_.@-]{1,200}$`만 받음. uuid가 아니어서 글자 열로 둔다 |
| `report_body` | text | null = 원래 글 그대로 / 글 = 보고에만 쓰는 글(1~1000자) → 줄 끝 작은 ✓ |
| `choice` | text | null = 창 규칙대로 / `out` = 빼기(칸 아래 '뺀 줄 n ⌄') / `in` = 접힌 줄을 꺼내 넣기·뺀 것 되돌리기 |
| `detail` | text | null = 기본 / `oneline` / `full`(2. 2) 사업 보고만) |
| `updated_at` | timestamptz | 서버 시각 |

- `unique (workspace_id, week_start, section, ref_kind, ref_key)`.
- **이어짐 규칙** [결정 — 명진 결정 Q-B(11/09 03:15) "1번 한번 뺐으면 담주도 빼"]: 그 주에 쓰이는 표시 = 같은 (section, ref)의 `week_start ≤ 그 주`인 행 중 가장 나중 행(상태 칩·지금 상황과 같은 방식). 창이 몇 주씩 겹치므로(2-6), 이번 주에 뺀 줄·보고용으로 고친 글은 다음 주 창에 다시 나와도 그대로 빠져 있고 고친 글로 보인다. 다음 주에 되돌리면 다음 주 행(`choice='in'` 또는 `report_body` 비움)이 생겨 그 주부터 바뀌고, 이번 주(사진이 있으면 사진)는 그대로다. 행은 통째로 이긴다 — 새 주 행을 만들 때 앞 행 값(`report_body`·`choice`·`detail`)을 복사하고 바꾼 칸만 고친다(`report_body = null`은 '원래 글').
- **'뺀 줄 n'은 그 주 창 안의 뺀 줄만 센다** [결정 — 명진 걱정 "뺀 줄이 엄청 많아지는 거 아냐?"(11/09 03:15)에 대한 답]:
  - n = 그 주 창(조직 = 지난 3주 ~ 앞 2주, 2-6)의 **후보**(창에 걸치는 기록·연결된 캘린더 일정) 가운데 이어짐 규칙으로 쓰이는 표시가 `choice='out'`인 줄의 수. 표시 표 전체를 세지 않는다. 칸 아래 '뺀 줄 n ⌄'을 펼쳐도 이 n줄만 보인다.
  - 그래서 창 밖으로 나간 옛 줄은 세지도 보이지도 않는다. 보통 기록(하루짜리)은 최대 6주(창 길이) 동안만 '뺀 줄'에 들어 있다가 저절로 사라진다. 기간 기록(end_day 있음)은 기간이 창에 걸치는 동안만 계속 센다. 예: 11.2~12.5 찬반투표를 11.9 주에 빼면 12.5가 창 시작(M − 21일)보다 앞이 되는 12.28 주부터 세지 않는다.
  - 표시 행 자체는 지우지 않고 남지만(그 주 사진·옛 주를 다시 열 때 필요), 앞으로의 창에 다시 나오지 않으므로 화면에서 쌓여 보이지 않는다. 행 수는 '빼거나 고친 횟수'만큼만 는다(주마다 복사하지 않음) — 한 주 20번이면 1년 약 1,000행으로 작업공간 상한 5,000행 안이다. 상한의 80%에 닿으면 정리 규칙(창이 다시 걸칠 수 없는 옛 표시 행 지우기)을 따로 정한다(9절).
  - 3. 2)(`section='site'`)도 같다: 그 주 창 후보 중 뺀 줄 + '창 이전 기록으로 3줄 채우기'(2-7)에서 채우다가 건너뛴 뺀 줄만 센다(채우기는 3줄을 채우면 멈추므로 끝없이 늘지 않음).
  - 2. 2)(사업)은 창이 그 주뿐이라 그 주 안의 뺀 줄만 센다.
- 행 지우기: 그 주 행이 바로 앞 행과 같은 값이 되면 지운다(표시만 지우는 것, 기록은 그대로). 그래서 authenticated에 delete를 준다.
- 트리거 `private.app_report_line_marks_guard`: `ref_key`가 같은 작업공간 것인지(조직 기록 → 조직 → 작업공간, 사업 기록·사업 보고 → workspace_id, 사업 → `app_space_in_workspace`; `event`는 모양 검사만 — 캘린더는 DB 밖이고, 다른 사람 일정 id를 넣어도 내 창에 그 일정이 없으면 아무 데도 쓰이지 않는다), `event`는 `section='org'`에서만 받음(2-9), 작업공간당 5,000행 상한(주마다 쌓이지 않고 바뀐 것만 남으므로 넉넉함), updated_at.
- 왜 draft jsonb에 두지 않나: draft는 200KiB 한 덩어리를 통째로 PATCH해 여러 화면이 동시에 고치면 부딪친다. 조직보고 표는 담당조직·업무일지·홈 세 곳에서 고친다 → 줄 하나 = 행 하나가 안전하다. 3. 2) 사업장 단위 빼기·순서(`draft.site_layout`)는 그대로 둔다(조직 단위라 겹치지 않음).
- '보고용으로 수정'은 보고에만 쓰인다. 원래 기록 글이 나중에 바뀌어도 보고용 글은 그대로이고, 표시 옆 ⋯ [원래 글로]로 그 주부터 지운다.

### 2-6. 주 경계와 창 기간 [결정 — 명진 결정 Q2(11/09)]

- 주 = 월요일 00:00 ~ 일요일 24:00, Asia/Seoul. 창의 기준 함수는 `journal-data.js` `weekStart`(서울 시각) 하나로 맞춘다. 새 순수 규칙 `record-window-model.mjs`는 `weekStart`를 받아 쓰고 새로 계산하지 않는다(다른 `weekOf` 정리는 범위 밖, 10절).
- **조직 창**(4. 1)·3. 2)) = 보고하는 주 월요일 M 기준 `[M − 21일, M + 21일)` = 지난 3주 + 이번 주 + 앞 2주(지난 쪽 약 1달, 앞 쪽 2주). 기본값은 `record-window-model.mjs` 상수 하나(`ORG_PAST_WEEKS=3`, `ORG_AHEAD_WEEKS=2`)로 두고, 바꿀 일이 생기면 상수만 고친다(사람별 설정은 범위 밖).
- **기간 기록**(end_day 있음, 예: 11.2~12.5)은 기간이 창에 조금이라도 걸치면 그 주 창에 나온다 → 기간 동안 여러 주에 나옴. 줄 앞 날짜는 `- 11.2.~12.5.` 모양.
- 앞 날짜 기록(예정 일정): 조직 기록 날짜를 앞날로 쓰면 앞 2주 안일 때 창에 나온다. '예정' 같은 말은 붙이지 않는다(명진이 쓴 글 그대로).
- **사업 창**(2. 2)) = 그 주(월~일)만 + 기간이 그 주에 걸친 기간 기록. 2. 1)은 창이 아니라 그 주의 '지금 상황'(2-4). 이유는 2-7 끝.
- DB 조회(조직): `occurred_at < 창 끝T00:00+09:00 and coalesce(end_day, occurred_at의 서울 날짜) >= 창 시작`. 인덱스 `(organization_id, occurred_at)`로 앞쪽을 좁히고, 기간 기록은 창 시작보다 길게 앞선 것이 드물어 `occurred_at >= 창 시작 − 90일`을 같이 건다(그보다 긴 기간 기록은 3. 2) 상태 칩이 보여 줌). 사업 기록은 `day <= 일요일 and coalesce(end_day, day) >= 월요일`.

### 2-7. 창의 규칙(순수 규칙, `record-window-model.mjs`)

**4. 1) 조직 칸** [결정]
1. 후보 = 그 조직의 창 기간 기록 + 그 조직과 연결된 창 안 캘린더 일정(2-9, 같은 일이 기록에 이미 있으면 일정 줄은 뺌) − 표시 `out`. 뺀 줄은 '뺀 줄 n ⌄'로 세고(2-5, 창 안의 것만), 일정 줄도 기록 줄과 똑같이 세고 고르고 접는다.
2. 늘 보임: 이번 주 줄 + 앞 2주 줄 + 이번 주에 걸친 기간 기록(일정 줄 포함 — 앞 1~2주 일정이 접혀 숨지 않음). 그다음 지난 1~3주 줄을 최근 것부터 채워 **조직당 최대 7줄**(`ORG_MAX=7`). 늘 보임 줄만으로 7을 넘으면 7을 넘겨도 다 보인다(이번 주 일을 숨기지 않음).
3. 넘친 지난 줄은 칸 아래 '지난 기록 n ⌄'로 접는다. 펼쳐 [넣기] = 표시 `in`(그 주부터), 넣은 줄은 상한과 상관없이 보인다.
4. 보이는 줄은 날짜 오름차순(기간 기록은 시작일 기준, 같은 날이면 기록 줄 먼저), 글은 `report_body ?? raw_text`(일정 줄은 `report_body ?? 일정 제목`), 줄 앞 `- M.D.` 형식은 지금 보고 형식 그대로. 조직 순서는 지금 4. 1) 순서 규칙, 상태(쟁의 단계)는 조직 칸 아래 작은 글씨.
5. **'지난주' 작은 표시** [결정]: 바로 앞 주 표(사진이 있으면 사진, 없으면 앞 주 창 결과)에 같은 기록이 있었던 줄은 줄 끝에 흐린 작은 '지난주'를 붙인다(화면에만, 한글 파일에는 없음). 반복 줄을 뺄지 고를 때 보라는 표시이고, 저절로 빼지는 않는다.

**3. 2) 투쟁 사업장** [결정 — 명진 결정 Q3(11/09)]
- 쟁의 단계 줄(지금 그대로) + 같은 조직 기록 **3~7줄**(`SITE_MIN=3`, `SITE_MAX=7`).
- 고르는 순서: 4. 1)과 같은 창 후보 − `out` 에서 늘 보임(이번 주·앞 2주·걸친 기간 기록) → 지난 1~3주 최근 것부터 7줄까지. 창 안 줄이 3줄이 안 되면 창 이전 기록을 최근 것부터 더해 3줄을 채운다(기록이 그만큼 없으면 있는 만큼). 넘친 것은 4. 1)처럼 접고 [넣기].
- 캘린더 일정 줄은 3. 2)에 넣지 않는다 [판단]: 3. 2)는 사업장 '현황'(쟁의 단계와 그동안의 기록) 칸이고, 앞으로의 일정은 같은 보고의 4. 1)에 이미 보인다(두 절에 같은 일정이 반복되지 않게). 넣고 싶어지면 `SITE_EVENTS` 상수 하나로 켠다.
- 빼기·보고용 글은 `section='site'` 표시로 4. 1)과 따로 둔다(같은 기록이라도 두 절에서 다르게 고를 수 있음). 사업장 빼기·순서는 `draft.site_layout` 그대로.

**2. 1) 사업요약표**: 줄 = '사업영역 관리' 목록(활성 `app_spaces` 1·2단). 칸 = 그 주의 `app_business_now.body`(또는 `report_body`) + 담당. 칸 아래 흐린 '이번 주 기록 n'(읽기만, 누르면 펼쳐 보기·누르면 원본 열기). — 이어 쓰기 원칙 그대로.

**2. 2) 주요 사업·회의결과**: 그 주 사업 기록 줄(+ 그 주에 걸친 기간 기록) + 사업 보고 줄을 사업별로 묶음, 활동 없는 사업은 빠짐, 내부 정례·'늘 빼기' 종류는 지금 규칙(`journal-meeting-kinds.js`)대로 제외, 사업 보고에 결과 본문이 있으면 기본 '상세 포함'(`detail` 표시로 한 줄만). 상세는 `(1) ○○ 결과` 소제목 + 본문, 본문 안 번호는 한 단계씩 내림(1.→1)→(1)→①, `docs/hwp-style-map.md`:26-38). 줄 수 상한은 두지 않는다(그 주 한 일 전부가 보고 대상).

**사업 쪽에 긴 창을 쓰지 않는 이유** [판단]: 조직보고는 '그 조직에 요즘 무슨 일이 있고 무엇이 다가오나'를 알리는 칸이라 몇 주가 겹쳐 보이는 것이 맞다(명진 Q2). 사업 쪽은 2. 1)이 이미 '지금 상황'을 이어 쓰며 흐름을 담고, 2. 2)는 '이번 주 한 일·회의 결과' 칸이라 지난 주 일을 다시 넣으면 주마다 같은 결과가 반복된다. 앞으로의 일정은 사업 보고의 다음 계획·지금 상황 글에 들어간다. 다만 표시 이어짐(2-5)·기간 기록 걸침·사진(2-8)은 사업 쪽에도 똑같이 쓴다. 나중에 2. 2)에도 앞 1~2주를 보이고 싶으면 `BIZ_AHEAD_WEEKS` 상수만 더하면 된다.

### 2-8. 지난 주 표 = 개인 확정본 사진 [결정 — 명진 결정 Q1(11/09)]

**지금 확정본이 있는 곳 [사실]**
- 원본 파일: 자료실 `app_documents` 중 '개인 확정본' 분류(역할 `personal`, `document-categories.js`:33-38) 한글 파일, Drive에 있음. [확정] 버튼(`journal-hwpx.js`:976-1010 `doConfirm`)이 만들어 저장하고, 다시 확정하면 같은 자료를 새 판으로 바꾼다.
- 그 주 임시저장 `app_weekly_exec_requests.draft`에 `confirmed {document_id, at}`(`weekly-draft-store.js`:409)와 `issued {at, from, lines:[{section, text}]}`(파일 1~4절 글 줄, `weekly-lines.mjs`:81-87)가 남는다.
- `issued` 줄은 절(`requests·work·struggle·orgs`)까지만 알고 **어느 조직·사업 줄인지 모른다**. 원본은 Drive 한글 파일이라 화면이 표를 그릴 때마다 열기엔 무겁다. 팀 확정본은 여러 사람 것이 합쳐진 것이라 명진 표의 기준이 아니다.

**새 자리 `app_report_snapshots`** [결정]

| 열 | 형 | 제약 |
| --- | --- | --- |
| `id` | uuid PK | |
| `workspace_id` | uuid NN | 고칠 수 없음 |
| `week_start` | date NN | 월요일 |
| `document_id` | uuid | 그 개인 확정본 자료(`app_documents`, 같은 작업공간 검사). 지워져도 사진은 남김(on delete set null) |
| `confirmed_at` | timestamptz NN | 서버 시각(트리거가 넣음, 화면 값 안 믿음) |
| `rows` | jsonb NN | `[{section, ref_kind, ref_key, label, lines:[{ref_kind, ref_key, day, end_day, text}], seen_events:[일정 id]}]`, 128KiB 상한(트리거). `seen_events` = 확정 때 그 조직 칸 후보였던 일정 id 전부(보인 줄·접힌 줄·뺀 줄, 2-9) |

- `unique (workspace_id, week_start)`. 같은 주를 새 판으로 확정하면 그 행을 통째로 바꾼다(update). 정책·권한은 2-3과 같은 owner 방식(select·insert·update, delete 없음).
- 쓰는 때: [확정]이 개인 확정본 저장에 성공한 직후 한 번. 사진 = 그때 화면 창 결과(4. 1)·3. 2)·2. 1)·2. 2)의 보이는 줄, 보고용 글 반영, 뺀 줄 제외). 한글 파일을 만든 바로 그 결과라 파일 글과 같다. 사진 저장이 실패해도 확정·파일 받기는 막지 않는다(그 주는 창 규칙으로 보임 + 작은 '사진 없음').
- 보여 주는 규칙(`record-window-model.mjs`):
  1. 사진이 있는 주: 표 = 사진 줄 그대로(고칠 수 없음, ⋯ 메뉴 없음, 맨 위 작은 '개인 확정본 11.14.').
  2. **확정 뒤 추가** = 그 주 창 규칙 후보 중 `created_at > confirmed_at`인 기록(사진에 없는 것), 그리고 그 주 창 후보 일정 중 `seen_events`에 없는 일정(캘린더 일정은 만든 시각을 읽지 않으므로 '확정 때 후보였나'로 가린다) → 같은 조직·사업 칸 맨 아래에 흐린 글씨 + 작은 '확정 뒤 추가'. 확정 뒤에 고친 기록·일정은 사진 글을 바꾸지 않는다(사진이 보고한 글).
  3. 흐린 줄을 정식으로 넣고 싶으면 그 주 [새 판으로 확정] → 사진이 바뀌어 흐린 줄이 정식 줄이 된다(따로 '넣기' 버튼 없음).
  4. 사진이 없는 주(확정 안 함·도입 전 확정): 이번 주와 같은 창 규칙 + 표시로 보이고 고칠 수 있다. 도입 전 주는 3-1 '도입 전 주 보고 줄 보존' 규칙(옛 표 읽기 전용)이 먼저다.
- `issued`(원장 W-3 대조용 평면 줄)는 그대로 둔다 — 쓰임이 다르다(파일 글 비교 vs 화면 칸 사진).

### 2-9. 조직보고 창의 구글 캘린더 일정 [결정 — 명진 결정 Q-A(11/09 03:15) "2번 어차피 수정하거나 뺄 수 있잖아"]

조직보고 4. 1) 창(지난 3주 ~ 앞 2주, 지난 일정 포함)에 조직 기록과 함께 **그 조직과 연결된 구글 캘린더 일정**을 저절로 보여 준다. 줄 끝에 작은 '일정' 표시.

**읽기만, 저장하지 않음** [결정]
- 일정은 기존 `google-calendar` Edge 함수의 로그인 사용자 길(`action=events`, 사용자의 Google 연결)로 그때그때 읽는다. 조직 기록·사업 기록 어디에도 복사하지 않는다(쓰는 곳 하나 원칙 그대로).
- DB에 남는 것은 사람이 누른 것뿐이다: [보고용으로 수정]·[보고에서 빼기]·접힌 줄 [넣기] 표시(`app_report_line_marks`, `ref_kind='event'`, `ref_key`=일정 id, 2-5), 그리고 [확정] 때 사진(2-8)에 보고한 줄 글. Edge 함수·권한은 바꾸지 않는다.
- 일정을 기록으로 만들고 싶으면 일정 줄 ⋯ [기록으로 남기기] = 조직 기록 [+ 쓰기] 창을 그 날짜·제목으로 미리 채워 여는 것까지(사람이 [저장]을 눌러야 저장, `source_kind='user'`). 저장되면 같은 일 중복 규칙(아래)으로 일정 줄은 감춰지고 기록 줄만 보인다.

**'그 조직과 연결된 일정' 판정** [결정 — 지금 저장소에 있는 세 길을 그대로 씀, 새 연결 자리 만들지 않음]

| 순서 | 길 | 지금 있는 곳 [사실] | 창에서 |
| --- | --- | --- | --- |
| ① | 일정에 붙인 조직 연결 | 일정 화면에서 일정에 담당조직을 붙이면 Google 일정의 비공개 속성 `kptu_suborg_ids`에 저장(`calendar-interactions-v2.js`:114 `organization_ids`), 읽을 때 `organizationIds`로 옴(`supabase/functions/google-calendar/index.ts`:36 `normEvent`) | 붙인 조직마다 그 조직 칸에 나옴(여러 조직이면 여럿에). 연결이 하나라도 있으면 ②는 보지 않는다 |
| ② | 일정 제목의 조직 이름·다른 이름 | 회의 전 한 장의 판정 `pre-meeting-sheet-model.mjs`:45-54 `eventOrg` — 연결이 없으면 제목에 내 조직 이름·`aliases`(2글자 이상, 띄어쓰기·문장부호 무시)가 **정확히 한 조직**만 맞을 때 그 조직 | 그 조직 칸에 나옴. 두 조직 이상 맞으면 어느 칸에도 넣지 않음(잘못 붙이지 않게) |
| ③ | 조직 참고 캘린더 | 내 프로필 '조직 참고 캘린더' = 구독 캘린더 하나 + 그 조직(`app_profiles.ledger_calendar`, `calendar-ref-model.mjs`·`calendar-ref-data.js`). 지금은 그 캘린더의 주요 일정 낱말(`ORG_REF_WORDS`, 중집 제외)에 맞는 일정만 [+] 추천 줄로 보임 | 그 캘린더 일정 중 지금과 같은 낱말 규칙(`isOrgRefTitle`)에 맞는 것만 그 조직 칸에 나옴. 그 캘린더는 다른 조직 전체 일정이라 낱말 없이 다 넣으면 너무 많음 |

- 판정 함수는 새로 만들지 않는다: ②는 `eventOrg`의 제목 판정 부분을 한 함수로 빼서(예: `titleOrg(event, orgs)`) 회의 전 한 장과 창이 같은 것을 부르고, ①은 연결된 조직 **전부**를 돌려주는 작은 함수로 둔다(회의 전 한 장은 지금처럼 첫 연결만 씀). ③은 `isOrgRefTitle`·`cleanTitle`을 그대로 import한다(AGENTS.md 4절 중복 구현 금지).
- 읽는 일정: 사용자가 일정 화면에서 고른 캘린더들(①②, 지금 `readEventsBetween`과 같은 읽기) + 조직 참고 캘린더(③, `onlyCalendarId`). 취소된 일정은 뺀다. 내 담당조직 목록에 없는(지운·비활성) 조직 연결은 버린다.
- 날짜: 종일 일정은 시작 날짜(여러 날 종일 일정은 끝 날짜 − 1일을 `end_day`로 → 기간 기록처럼 걸치면 매주), 시각 일정은 서울 날짜. 줄 모양은 기록과 같은 `- 11.20. 제목`(시각은 붙이지 않음, 글은 `cleanTitle` 80자).
- **같은 일 중복** [결정]: 같은 조직 칸에 같은 날(기간 기록이면 그 기간 안)이고 일정 제목이 기록 글에 들어 있는(띄어쓰기·문장부호 무시, 지금 `alreadyIn`과 같은 비교) 기록이 있으면 일정 줄은 감춘다(기록이 이김). 같은 일정 id가 두 캘린더에서 오면(초대받은 일정) 한 줄로 친다.
- **상한·접기**: 일정 줄도 조직당 7줄(`ORG_MAX`)·'늘 보임'·'지난 기록 n ⌄' 접기에 기록 줄과 똑같이 들어간다(2-7). 앞 2주 일정은 '늘 보임'이라 접히지 않는다.
- 줄 ⋯ 메뉴: [보고용으로 수정](작은 ✓) · [보고에서 빼기](다음 주에도 빠짐, Q-B) · [기록으로 남기기] · [일정 열기](기존 일정 열기 길). [수정][삭제]는 없다(일정은 일정 화면에서 고침).
- 한글 파일: 보이는 일정 줄은 4. 1)에 기록 줄과 똑같은 모양으로 들어간다('일정' 표시는 화면에만). 3. 2)에는 넣지 않는다(2-7).
- 사업 쪽(2. 1)·2. 2))에는 이번 설계에서 일정 줄을 넣지 않는다(질문이 조직보고에 대한 것, 2-7 끝 이유와 같음).

**표를 열 때 느려지지 않게** [결정]
1. 표를 먼저 그린다: 조직 기록·표시·사진으로 칸을 그리고, 일정 읽기는 기다리지 않는다. 일정이 오면 같은 창 부품(`record-window.js`, 상태 주인 하나)이 상태를 고치고 한 번 다시 그린다(늦은 덮어쓰기·`MutationObserver` 땜질이 아니라 같은 주인의 다시 그리기, AGENTS.md 5절). 읽는 동안 칸 아래 작은 '일정 읽는 중', 실패하면 '일정을 못 읽었어요'(기록 줄은 그대로).
2. 이미 읽어 둔 달력 자료를 다시 쓴다: 홈 [주간 정리]는 그 주 일정(`readWeekScheduleEvents`)과 다음 주부터 2주 일정(`readScheduleEvents`, 5. 주요 일정)을 이미 읽는다 → 창 [M, M+21일)은 거의 다 덮인다. 창 부품은 화면이 넘겨준 이미 읽은 일정 목록을 받아 쓰고, 빠진 날(지난 3주 [M−21일, M))만 한 번 더 읽는다. 이미 읽은 자료가 없는 화면(담당조직 전체 표 등)은 [M−21일, M)·[M, M+21일) 두 범위로 나눠 동시에 읽는다(한 범위가 너무 길어 읽기 상한에 걸리지 않게, 9절).
3. 한 번 읽은 범위는 화면 세션 안 메모리에 5분 동안 다시 쓴다(사용자·범위 열쇠, 회의 전 한 장 `pre-meeting-sheet.js`:67-79 `eventCache`와 같은 방식, 브라우저 저장소 아님). 담당조직 전체 표·업무일지·홈이 같은 주를 차례로 열어도 한 번만 읽는다. 같은 요청이 동시에 나가면 `runtime-client.js` 한 번 보내기(singleFlight)가 합친다.
4. 일정을 쓰지 않는 사람(Google 연결 없음)은 읽지 않는다(`status`가 연결 없음이면 일정 줄 없이 그림). 조직 참고 캘린더를 고르지 않았으면 ③ 읽기를 하지 않는다(지금과 같음).
5. 이 일정 줄이 지금의 '캘린더 추천' 줄([+]로 보고에 넣던 것, `calendar-ref-model.mjs` `reportLine`·`alreadyIn` 쓰임)을 대신한다 → O-6에서 추천 줄·[+] 길을 지운다(조직 참고 캘린더 고르기와 `summaryCalendar`(4. [요약 만들기] 재료)는 그대로).

---

## 3. 옛 자료 옮기기·되돌리기

### 3-1. 옮기기 [결정] — 지우지 않고 복사, 다시 돌려도 같은 결과

| 옛 자리 | 옮기는 곳 | 방법 |
| --- | --- | --- |
| `app_org_status_rows` 모든 줄 | 조직 기록 | `occurred_at = day 12:00+09`, `end_day`, `raw_text = body`, `source_kind='status_row'`, `source_id = 원래 id`, `created_at = 원래 created_at`. 같은 조직·같은 날·같은 글의 기록이 이미 있으면 건너뜀 |
| `app_weekly_org_lines` 중 state=`in`이고 원래 기록이 없는 줄(origin user·plain, 또는 source 번호가 비었거나 원래 기록이 지워짐) | 조직 기록 | `occurred_at = coalesce(day, week_start) 12:00+09`, `source_kind='weekly_line'`, `created_at = 원래 created_at`, 위와 같은 건너뛰기 |
| `app_weekly_org_lines` 중 state=`in`·`edited=true`이고 원래 기록이 하나인 줄 | 표시 표 | 그 주 `section='org'`, `ref_kind='org_update'`, `ref_key = 원래 기록 id`, `report_body = body`. 이어짐 규칙(2-5) 때문에 옮긴 표시는 전환 주 이후에도 이어지므로, 전환 주 `week_start`에 `report_body = null` 행을 함께 넣어 끊는다(옛 주 보고 글이 새 주에 저절로 따라오지 않게) |
| `app_project_progress_updates`(#2143 이후 생긴 [사업] 줄 포함) | 사업 기록 | `source_kind='progress'`, `day = effective_on`, `space_id = project_id`(같은 작업공간 사업일 때만, 아니면 건너뛰고 개수만 보고) |
| `draft.rows`(section summary)·`draft.owners` | 사업 지금 상황 | 화면이 한 번 채움(아래) |

- **도입 전 주 보고 줄 보존** [결정, 처음 Q1 ★ — 명진 결정(11/09)은 2-8 사진으로 이어짐]: 전환 주(DB·화면 적용 주) **이전** 주는 옛 표(`app_weekly_org_lines` state=in, 옛 draft)를 그대로 읽어 보여 준다(읽기 전용, '옛 보고' 작은 표시). 그래서 옛 주의 조직보고 표·사업요약표는 그때 보고한 글 그대로다. 전환 주부터는 사진(2-8)이 있으면 사진, 없으면 창 규칙을 쓴다. 전환 주는 코드 상수 하나(`RECORD_ONE_FROM`, 화면 PR에서 운영 적용 뒤 정함).
- **원장 자동 기록 중복 막기**: 옮긴 줄(`status_row`·`weekly_line`·`progress`)은 원장 자동 기록 재료에서 뺀다(이미 원장에 같은 사실이 있거나 옛 사본). 원래 `created_at`을 그대로 두고, ai-assist 재료 읽기에 `source_kind` 거르기를 더한다(Edge 배포 정지 지점, 5절 O-6).
- **지금 상황 처음 채우기(BIZ)**: 사업 지금 상황 표가 비어 있는 사업에 한해, 사업 보고 '이번 주 주간보고'나 홈 [주간 정리]를 처음 열 때 화면이 한 번 채운다 — ① 가장 최근 팀 확정본 한글 파일의 사업요약표 칸 글(기존 `weekly-base.js` 읽기 재사용), 없으면 ② 그 주 `draft` summary 칸 글, 둘 다 없으면 '—'. 채운 행은 전환 주 `week_start`로 넣는다. 한글 파일은 Drive에 있어 SQL로 읽을 수 없어 화면에서 한다. 사람이 고친 값은 덮지 않는다(행이 이미 있으면 건너뜀).

### 3-2. 되돌리기

- 화면: 각 화면 PR을 되돌리면(revert PR) 옛 화면이 돌아온다. 옛 표를 지우지 않았으므로 옛 화면은 그대로 읽힌다. 단 되돌린 동안 새 주 조직보고 줄은 비게 되고, 옛 화면 4. 1)은 그 주 기록으로 대신 채우는 길(`journal-weekly.js`:355-366)이 이미 있다.
- DB 구조: 새 표 4개(`app_business_records`·`app_business_now`·`app_report_line_marks`·`app_report_snapshots`) drop, 조직 기록의 새 열 3개(O-2에서 더했다면 `created_at`까지)·인덱스·트리거 drop(새 열만, 기존 열·정책 그대로). 사진 표를 지우면 지난 주 표가 창 규칙으로 다시 계산되어 보일 뿐, 개인 확정본 파일은 자료실에 그대로 있다. migration마다 rollback SQL·snapshot 짝 파일을 둔다(`docs/ops-db-workflow.md`).
- 옮긴 자료: `source_kind in ('status_row','weekly_line')`인 조직 기록 행, `source_kind='progress'`인 사업 기록 행만 지우는 rollback SQL로 정확히 되돌린다(원래 자료는 그대로 있으므로 손실 없음). 전환 뒤 새로 쓴 기록은 되돌리기에서 지우지 않는다.

---

## 4. 화면별 변경 목록

| 화면 | 지금 | 바뀐 뒤 |
| --- | --- | --- |
| 담당조직 목록 | 상태 칩·마지막 기록 날짜 | 그대로(마지막 날짜는 옮긴 기록 포함) |
| 담당조직 [전체 표] '이번 주 조직보고' (`org-overview.js`) | 주별 줄 + 제안 + 지난주 가져오기 + '+ 줄' | 창 부품: 조직 칸 = 지난 3주~앞 2주 창의 기록 줄 + 연결된 캘린더 일정 줄(작은 '일정', 2-9)(합쳐 조직당 7줄, 넘친 지난 줄은 '지난 기록 n ⌄'에서 [넣기]) + [+ 쓰기](그 조직 기록에 쌓임, 날짜 = 오늘, 바꿀 수 있음). 줄 끝 흐린 '지난주'(앞 주 표에도 있던 줄). 줄 ⋯ = [보고용으로 수정](작은 ✓) · [보고에서 빼기](이번 주부터, 칸 아래 '뺀 줄 n ⌄'에서 되돌리기) · [기록 열기]. 상태는 조직 칸 아래 작은 글씨. 지난 주로 넘기면 개인 확정본 사진 + 흐린 '확정 뒤 추가'(2-8) |
| 조직 상세 (`workplace-detail.js`) | [기록]·[현황 표] 두 소탭 | '날짜 \| 기록' 한 표(날짜 내림차순, 최근 n줄 + '지난 기록 n ⌄'). 줄 ⋯ = [수정][삭제][원래 통화·글 보기(source 있을 때)]. [+ 쓰기]. [현황 표] 소탭·[AI로 채우기] 삭제(`org-status-table.js` 쓰기 길 삭제, 표 자료는 보존) |
| 업무일지 '이번 주 보고'(JOURNAL-이번주보고표) | 시안만(#2136 merge, 구현 PR 없음) | 왼쪽 = 조직보고 창, 오른쪽 = 사업요약 창을 **붙이기만** 한다(새 저장 없음). 4-1절 |
| 홈 [주간 정리] 2. 1) | 바탕 깔기 + 칸 아래 제안 다섯 종류 + 직접 쓰기 | 사업요약 창: 칸 = 지금 상황(누르면 그 자리 수정 → `app_business_now`), 담당, 흐린 '이번 주 기록 n'. 제안·바탕 깔기 삭제 |
| 홈 [주간 정리] 2. 2) | 사업 보고 자동 한 줄 + `draft.hand` | 주요 사업 창: 그 주 사업 기록 + 사업 보고(상세 포함), 줄 ⋯ = [보고용으로 수정]·[이번 보고에서 빼기]·[한 줄만 ↔ 상세 포함]·[기록 열기], 사업 묶음 아래 [+ 쓰기](사업 기록). 이 종류 늘 빼기는 그대로 |
| 홈 [주간 정리] 3. 2) | 쟁의 단계 + 넣은 줄 또는 현황 표 줄 | 쟁의 단계 + 같은 창의 조직 기록 3~7줄(2-7, 넘치면 접기·[넣기], 모자라면 창 이전 기록으로 3줄 채움). 사업장 빼기·순서 그대로 |
| 홈 [주간 정리] 4. | 주별 줄 표 + 그 조직 칸의 '캘린더 추천' 줄([+]) | 조직보고 창(담당조직 전체 표와 같은 부품, 일정 줄 포함 — 이미 읽은 그 주·5. 주요 일정 자료를 넘겨 다시 읽지 않음). '캘린더 추천' [+] 줄은 일정 줄이 대신해 없어짐(O-6). 지난 주를 열면 개인 확정본 사진(고칠 수 없음) + 흐린 '확정 뒤 추가' |
| 사업 보고 '이번 주 주간보고' (`weekly-summary-table.js`) | 진행·담당 직접 쓰기 + 칸 아래 그 주 보고 제목 + 2) 목록(홈의 빼기를 못 읽음) | 2. 1)·2. 2) 창을 홈과 같은 부품으로(두 화면 불일치 사라짐) |
| 한글 파일 (`journal-hwpx.js`, `weekly-hwpx/*`) | 4. 1) = 넣은 줄, 2. 1) = 바탕 + 고친 칸 + owners, 2. 2) = 비움 | 같은 창 규칙 결과를 그대로 넣음: 4. 1)(보이는 일정 줄 포함, '일정' 표시 없이)·3. 2)·2. 1)(지금 상황+담당)·2. 2)(줄 + 상세, `delta.mjs`:108 비움을 창 결과로, 그리기 `report.mjs`:394-414 재사용). 지난 개인본 바탕 깔기는 사업요약 칸에서 삭제(다른 절의 바탕 쓰임은 그대로). [확정] 성공 직후 그 창 결과를 `app_report_snapshots`에 한 번 저장(2-8) |
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
| O-1 | 설계(이 PR) | 이 문서 | — | 명진 결정 Q1~Q3(11/09 02:18)·Q-A·Q-B(11/09 03:15) 모두 받음, 남은 결정 질문 없음 |
| O-2 | ★DB★ 조직 기록 넓히기 + 표시 표 | `app_suborganization_updates` 새 열 3(+ 없으면 `created_at`)·인덱스·검사 트리거, `app_report_line_marks` 새 표(`ref_key` 글자 열·`choice`·이어짐은 화면 규칙, `ref_kind`에 `event` 포함 — 일정 id 모양 검사·`section='org'`만), `app_report_snapshots` 새 표(주당 1행, 128KiB 상한), 모두 owner 정책·칸 권한·트리거, 짝 파일 5개 | ★DB 적용 정지★ | 시험 적용 통과, 사후 확인: 정책 수·anon 권한 없음·기존 정책 해시 같음, 기존 앱 회귀 없음(열 추가뿐) |
| O-3 | ★DB★ 옛 조직 자료 옮기기 | 3-1 조직 행 복사(멱등, 건너뛰기), 옮긴 개수 보고 SQL | ★DB 적용 정지★ (운영 데이터 변경) | 옮긴 수 = 사전 확인 대상 수 − 건너뛴 수, 다시 돌리면 0건 |
| O-4 | 창 부품 + 조직보고 표 | `record-window-model.mjs`·`record-window.js`, 담당조직 전체 표·홈 4.·업무일지(있으면) 연결, 저장 길에 `source_kind`(조직 상세·업데이트·통화·소식 #2143), 창 기간·조직당 7줄·접기·[넣기]·'지난주' 표시·표시 이어짐·'뺀 줄 n'(창 안만), **캘린더 일정 줄(2-9)**: 연결 판정 ①②③(`eventOrg` 제목 판정을 함께 쓰는 함수로 빼기, `isOrgRefTitle` 재사용), 기록과 같은 일 감추기, 일정 줄 ⋯([보고용으로 수정]·[보고에서 빼기]·[기록으로 남기기]·[일정 열기]), 표 먼저 그리고 일정은 뒤에 같은 주인이 다시 그림, 이미 읽은 달력 자료 받기 + 빠진 날만 읽기 + 5분 메모리 재사용, 사진 읽기(있으면 사진 + '확정 뒤 추가', 일정은 `seen_events`로), 전환 주 상수·옛 주 읽기 전용, release-notes | — | 단위 시험(주 경계·창 걸침·기간 기록 여러 주·7줄 상한(일정 줄 포함)·늘 보임 줄(앞 2주 일정 포함)·표시 이어짐(뺀 줄 다음 주에도 빠짐, 다음 주 되돌리면 이번 주 그대로)·**창 밖 뺀 줄은 세지 않음**(하루 기록 6주 뒤, 기간 기록 끝날 + 21일 뒤 n에서 빠짐)·3. 2) 채우다 건너뛴 뺀 줄만 셈·일정 연결 ①②③(두 조직 맞는 제목은 어디에도 안 넣음, 연결 있으면 제목 판정 안 함)·일정 중복(기록과 같은 일, 같은 id 두 캘린더)·여러 날 종일 일정 걸침·취소 일정 뺌·`event` 표시 이어짐·사진·확정 뒤 추가(기록 `created_at`, 일정 `seen_events`)·옛 주), E2E(폰·PC: 쓰기 → 그 주 칸에 보임, 빼기 → 뺀 줄 n, 되돌리기, 가짜 일정 → 일정 줄 보임·빼기 → 다음 주에도 빠짐, 일정 읽기 실패해도 기록 줄은 보임, 같은 주를 두 화면에서 열어도 일정 읽기 한 번), CI 통과 |
| O-5 | 조직 상세 합치기 | [기록]·[현황 표] → '날짜 \| 기록' 한 표, 현황 표 쓰기·[AI로 채우기] 삭제 | — | E2E 상세, 삭제한 화면 경로 참조 0 |
| O-6 | 한글 파일 + 옛 제안 코드 삭제 | 4. 1)·3. 2)(3~7줄) 창 결과, [확정] 때 사진 저장(4. 1)·3. 2)), `weekly-org-suggest.js`·`weekly-org-lines.js` 쓰기 길·`quick-save.js` 제안 호출 삭제, 4. 조직 칸 '캘린더 추천' 줄·[+] 길 삭제(일정 줄이 대신함, 조직 참고 캘린더 고르기·`summaryCalendar`는 그대로), 한글 4. 1)에 보이는 일정 줄 포함·사진 `seen_events` 저장, ai-assist `org_week_lines` 삭제 + 원장 재료 `source_kind` 거르기 | ★Edge 배포 정지★(ai-assist, 되돌리기 ref 기록) | 한글 파일 시험(4. 1)·3. 2) 줄 같음, 사진 줄 = 파일 줄), 서버 시험, 배포 뒤 401·OPTIONS |
| B-1 | ★DB★ 사업 표 | `app_business_records`·`app_business_now` 새 표, 표시 표 section·ref 값은 O-2에 이미 있음 | ★DB 적용 정지★ | O-2와 같은 사후 확인 |
| B-2 | ★DB★ 옛 사업 진행 기록 옮기기 | `app_project_progress_updates` → 사업 기록(멱등) | ★DB 적용 정지★ | 옮긴 수 보고 |
| B-3 | 2. 1) 사업요약 창 | 지금 상황·담당 쓰기·처음 한 번 채우기, 칸 아래 '이번 주 기록 n', 홈·사업 보고·업무일지 연결, 업데이트·소식 [사업] → 사업 기록 | — | 단위·E2E(이어 씀: 지난주 글이 이번 주에 보임, 이번 주 고쳐도 지난주 그대로) |
| B-4 | 2. 2) 주요 사업 창 + 상세 포함 + 한글 파일 | 사업 기록 + 사업 보고 묶기, [한 줄만 ↔ 상세 포함], `delta.mjs` details 연결, 번호 한 단계씩, 사진에 2. 1)·2. 2) 더하기 | — | 한글 파일 시험(번호 규칙), E2E |
| B-5 | 옛 사업 제안·바탕 깔기 삭제 | `weekly-flow-cells.js` 제안·[넣기]류·바탕 깔기, `draft.hand.details` 쓰기 길, ai-assist `weekly_line` | ★Edge 배포 정지★ | 삭제 경로 참조 0, 시험 통과 |

- 같은 파일을 만지는 단계는 앞뒤로 줄 세운다(O-4 → O-5 → O-6, B-3 → B-4 → B-5; O-4와 B-3은 `journal.js`·`journal-hwpx.js`가 겹쳐 O 다음 B).
- 사진은 한글 파일이 창 결과를 쓰기 시작하는 O-6부터 찍는다(그 전 [확정]은 옛 한글 파일 줄이라 창 사진과 맞지 않음). O-4~O-6 사이 주는 '사진 없는 주' 규칙(창으로 보임)을 따른다. 사업 쪽 사진 칸은 B-4에서 더한다.
- 옛 표(`app_org_status_rows`·`app_weekly_org_lines`·`app_project_progress_updates`·draft 칸)는 이 설계에서 지우지 않는다. 지우는 것은 명진이 따로 요청할 때만.

---

## 6. 명진에게 보일 일상어 3줄

**조직 (ORG-기록하나로)**
- 무엇이 바뀌나: 조직마다 '날짜 + 한 줄' 기록 하나에만 씁니다. 주간보고 조직보고 표는 지난 3주부터 앞으로 2주까지의 기록과 그 조직에 연결된 구글 캘린더 일정(작은 '일정' 표시, 읽어서 보여 주기만)을 합쳐 조직당 7줄까지 보여 주고(기간이 있는 일은 그 기간 내내), 투쟁 사업장 현황은 같은 기록 3~7줄을 씁니다. 빼거나 보고용으로 고친 줄은 다음 주에도 그대로 이어지고, [확정]한 주는 그때 표를 사진처럼 남겨 그대로 보여 줍니다.
- 잘못되면: 옮긴 옛 줄이 두 번 보이거나, 몇 주 지난 일이 다음 주 표에 또 보일 수 있습니다('지난주' 작은 표시로 알 수 있고 빼면 다음 주에도 빠짐). 캘린더의 사소한 일정이 들어올 수 있지만 한 번 빼면 계속 빠지고, '뺀 줄'은 그 주 창(지난 3주~앞 2주) 안의 것만 세므로 쌓이지 않습니다. 캘린더를 못 읽으면 일정 줄만 안 보이고 기록 줄은 그대로입니다. 기록 자체와 개인 확정본 파일은 지워지지 않습니다.
- 되돌리는 방법: 화면은 이전 판으로 되돌리면 옛 표가 그대로 나옵니다(옛 자료를 지우지 않았기 때문). 옮긴 줄은 '옮긴 표시'가 붙어 있어 그 줄만 정확히 지울 수 있고, 새로 만든 표시·사진 표는 지워도 기록과 확정본 파일에 영향이 없습니다.

**사업 (BIZ-기록하나로)**
- 무엇이 바뀌나: 사업마다 기록·'지금 상황'·담당을 한 번만 씁니다. 사업요약표는 지금 상황을 이어 쓰고, 주요 사업·회의결과는 그 주 기록과 사업 보고가 저절로 들어갑니다(조직처럼 몇 주를 겹쳐 보이지는 않음). 지난주 한글 파일을 깔던 것과 칸 아래 제안 다섯 종류는 없어집니다.
- 잘못되면: 처음 바꾼 주에 지금 상황 칸이 비거나 옛 글로 채워질 수 있고, 활동 없는 사업은 2. 2)에서 빠집니다. 지난 확정본·임시저장은 그대로 남습니다.
- 되돌리는 방법: 화면을 이전 판으로 되돌리면 옛 임시저장 표가 그대로 나옵니다. 새로 만든 사업 표는 지워도 옛 자료에 영향이 없습니다.

---

## 7. 명진 결정(11/09 02:18·03:15)

받은 답(원문 요지)과 이 문서에 넣은 곳:

| 질문 | 명진 답 | 반영 |
| --- | --- | --- |
| Q1 지난 주 보고 표 | 홈에서 이전 기록을 볼 때 개인 확정본이 들어가 있으면 됨. 확정 뒤 더할 것이 있으면 흐리게 등 다르게 | 2-8: [확정] 때 표 사진(`app_report_snapshots`), 확정 뒤 새 기록·새 일정은 흐린 '확정 뒤 추가'. 도입 전 주는 옛 표 읽기 전용(3-1) |
| Q2 기간 기록이 나오는 주 | 기간이 지난 주에도 들어갈 수 있음. 조직보고는 보통 최근 2주~1달 중요 일정 + 앞 1~2주 | 2-6·2-7: 조직 창 = 지난 3주 + 이번 주 + 앞 2주, 기간이 걸치면 매주, 조직당 7줄·접기·[넣기]·'지난주' 표시, 표시 이어짐(2-5). 사업 쪽은 그 주만(2-7 끝 이유) |
| Q3 투쟁 사업장 현황 줄 수 | 딱 정하기 어려움, 작게 3줄 많게 6~7줄 | 2-7: 같은 창에서 3~7줄, 모자라면 창 이전 기록으로 3줄 채움 |
| Q-A 조직보고 '앞으로 1~2주 일정'을 어디서 (11/09 03:15) | 2번 — "어차피 수정하거나 뺄 수 있잖아" | 2-9: 조직 기록 + 그 조직과 연결된 구글 캘린더 일정(작은 '일정', 창 안 지난 일정 포함). 읽어서 보여 주기만, 저장 안 함. 연결 판정 = 일정에 붙인 조직 → 제목의 조직 이름·다른 이름(한 조직만 맞을 때) → 조직 참고 캘린더(주요 일정 낱말). [보고용으로 수정]·[보고에서 빼기]는 `ref_kind='event'` 표시(2-5). 7줄 상한·접기에 포함. 표는 먼저 그리고 일정은 이미 읽은 달력 자료 재사용 + 빠진 날만 읽기 |
| Q-B 뺀 줄은 다음 주에 (11/09 03:15) | 1번 — "한번 뺐으면 담주도 빼" | 2-5 이어짐 규칙 그대로(★안): 한 번 뺀 줄·보고용으로 고친 글은 다음 주에도 그대로, '뺀 줄 n ⌄'에서 되돌리면 그 주부터 |
| 걱정: "이런식이면 뺀 줄이 엄청 많아지는 거 아냐?" (11/09 03:15) | — | 2-5: '뺀 줄 n'은 그 주 창(지난 3주~앞 2주) 안에 들어오는 뺀 줄만 센다. 창 밖으로 나간 옛 줄은 세지도 보이지도 않아 쌓이지 않는다(하루 기록은 최대 6주, 기간 기록은 기간이 창에 걸치는 동안만). 표시 행은 빼거나 고친 횟수만큼만 늘어 상한 안. 단위 시험 '창 밖 뺀 줄은 세지 않음'(5절 O-4) |

### 남은 결정 질문

없음. 이 밖의 구조 선택(조직 기록은 기존 자리 넓히기, 사업 기록·지금 상황·표시·사진은 새 자리, 사업 보고는 복사하지 않고 함께 보여 주기, 창 길이·7줄 상한 기본값, 일정 연결 판정 순서, 3. 2)·사업 쪽에는 일정 줄을 넣지 않음)은 기술 판단이라 이 문서가 정했다. 창 길이·상한·3. 2) 일정 넣기는 상수라 써 보고 바꾸기 쉽다.

## 8. 보안·권한 확인

- 새 표 4개(`app_business_records`·`app_business_now`·`app_report_line_marks`·`app_report_snapshots`): RLS 켬, 정책 하나 = `private.app_is_workspace_owner(workspace_id)`, anon·PUBLIC 권한 없음, authenticated는 칸 단위 넣기·고치기, 같은 작업공간 검사는 트리거(security invoker, `search_path=''`). 화면이 보낸 작업공간·사업·조직 번호는 트리거·정책이 다시 판정한다(AGENTS.md 3절 3). 사진 표의 `confirmed_at`은 서버 시각, `document_id`는 같은 작업공간 자료인지 트리거가 검사하고, `rows`는 크기 상한만 두고 화면에서 글로만 그린다(HTML로 넣지 않음).
- 조직 기록: 기존 정책·권한을 바꾸지 않고 열만 더한다. 옮긴 종류는 로그인 사용자가 만들 수 없다.
- 운영자 전용 기능(통화·텔레그램)은 지금처럼 서버 판정. 이 설계는 소식을 기록으로 옮기는 버튼만 다룬다.
- 외부 입력(통화·텔레그램)에서 기록까지는 늘 명진의 [조직]·[사업] 누름을 거친다(자동 연결 없음).
- 캘린더 일정(Q-A, 2-9): 기존 `google-calendar` 함수의 로그인 사용자 길(사용자 자기 Google 연결)로 읽어서 보여 주기만 하고 기록으로 저장하지 않는다. Edge 함수·인증 경계·권한은 바꾸지 않는다. 일정에서 기록이 되는 것은 사람이 [기록으로 남기기] → [저장]을 누를 때뿐(자동 연결 없음). DB에 남는 일정 관련 값은 사람이 누른 표시(일정 id·보고용 글)와 [확정] 사진의 보고한 줄 글뿐이고, 둘 다 내 작업공간 owner 정책 안이다. 일정 제목은 화면에서 글로만 그린다(HTML로 넣지 않음). 일정 id는 모양만 검사한다 — 남의 일정 id를 넣어도 내 창에 그 일정이 없으면 쓰이지 않으므로 다른 작업공간·다른 사람 일정을 읽는 길이 생기지 않는다.
- RTW 표(`rtw_*`)·`app_spaces`·`app_meetings` 모양은 바꾸지 않는다.

## 9. 남은 위험

- [확정]하지 않은 주는 사진이 없어, 보고를 보낸 뒤 원래 기록을 고치면 그 주 창의 글도 바뀐다(보고용 글을 쓴 줄은 제외). 확정한 주는 사진이 지킨다. 보낸 보고의 원본은 여전히 자료실 한글 파일이다.
- 창이 몇 주 겹쳐 같은 일이 여러 주 표에 반복된다(명진이 원한 동작). 조직당 7줄로 묶고 '지난주' 표시·빼기 이어짐으로 다루지만, 써 보고 길면 상수(`ORG_PAST_WEEKS`·`ORG_MAX`)를 줄인다.
- 표시 이어짐 때문에 몇 달 전에 뺀 기록이 기간 기록으로 다시 걸칠 때도 빠져 있다(의도). 왜 안 보이는지 헷갈리면 '뺀 줄 n ⌄'에서 보인다.
- '확정 뒤 추가'는 `created_at`(서버 시각)으로 가린다. 확정 전에 써 둔 기록의 날짜만 나중에 바꾸면 흐린 줄로 나오지 않는다(사진에 없고 새 줄도 아님 → 보이지 않음). 화면 PR에서 '사진에 없고 지금 창에 있는 줄'을 모두 흐리게 보일지 시험으로 정한다.
- `app_suborganization_updates`·`app_project_progress_updates`는 만든 SQL이 저장소에 없어 열·권한 모양을 운영 사전 확인으로만 안다(O-2·B-2 사전 확인 SQL에서 맞지 않으면 멈춤).
- 사업 보고를 복사하지 않으므로, 사업 보고를 휴지통에 넣으면 그 주 창에서도 사라진다(의도된 동작).
- 캘린더 일정 줄(2-9): ② 제목 판정은 조직 이름이 들어간 사소한 일정(예: 그 조직 사람과의 식사)도 데려온다 — 명진 답대로 빼면 다음 주에도 빠진다. 반대로 제목에 이름이 없고 연결도 안 붙인 일정은 나오지 않는다(일정 화면에서 조직을 붙이면 나옴).
- 일정을 Google에서 지우거나 날짜를 옮기면 창에서도 사라지거나 옮겨진다(저장하지 않으므로). 확정한 주는 사진이 지킨다. 확정하지 않은 지난 주는 그때 일정이 지금 바뀐 대로 보인다.
- `google-calendar` 함수는 캘린더마다 최대 250개만 읽고 다음 쪽을 읽지 않는다([사실] `index.ts`, `nextPageToken` 없음). 지난 3주만 따로 읽어 범위를 나누지만, 한 캘린더가 한 범위에 250개를 넘으면 일부가 빠질 수 있다 → 화면은 한 캘린더 일정 수가 250이면 칸 아래 작은 '일정 일부만'을 보인다(함수 고치기는 범위 밖, 10절).
- 일정 id는 Google이 정하는 값이라 반복 일정을 '이후 모두' 바꾸면 회차 id가 바뀔 수 있다 → 그 일정에 해 둔 빼기·보고용 글이 풀려 다시 나올 수 있다(다시 빼면 됨).

## 10. 범위 밖 발견사항(고치지 않음)

- 같은 일을 하는 주 경계 함수가 여섯 곳(1-1 끝). 창은 `journal-data.js` `weekStart` 하나만 쓰고, 나머지 정리는 따로.
- 2. 1) [AI 요약] 태그는 채우는 곳이 없어 지금 어디에도 나오지 않는 것으로 보임 [추정] — B-5에서 함께 삭제됨.
- `app_weekly_org_summaries`·`app_suborganization_weekly_reports`는 읽지도 쓰지도 않고 보존만 하는 옛 표.
- 원장 W-3(`draft.issued` 대조) 사본 `_shared/weekly-lines.mjs`를 import하는 함수가 없음.
- '보고용으로 수정' 내용을 환류 학습 재료로 쓸지는 따로 정할 일.
- `google-calendar` 함수의 일정 읽기가 캘린더마다 250개에서 멈춤(다음 쪽 읽기 없음). 9절 위험, 고치려면 Edge 배포 정지 지점이 있는 별도 작업.
- 표시 표(`app_report_line_marks`)의 창이 다시 걸칠 수 없는 옛 행 정리 규칙은 상한 80%에 닿을 때 따로 정한다(2-5).
