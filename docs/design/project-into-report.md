# 프로젝트를 사업 보고로 합치기 설계 (MTG-프로젝트합치기)

📱 폰 가능(이 문서) · 1단계 설계 + DB PR. 화면 변경은 이번 PR에 없다(다음 세션).

- 작성: 2026-10-28, Claude Code 웹(작업 세션). 기준 main `f38de9af`(#1396). 운영 DB·Drive는 이 세션에서 보지 않았다.
- 요청: 요청함 2026-10-28 18:47 "프로젝트를 사업 보고로 합치기 — 기록은 사업 보고 한 곳, [사업요약표 미리보기]"(명진 18:41, 아이디어 회의 뒤 18:47 'ㅇㅋ').
- 이번 PR의 DB: `supabase/migrations/20261028191500_bizreport_area_next_plan.sql` + 짝 파일(`docs/20261028191500_bizreport_area_next_plan.{precheck,snapshot,postcheck,rollback,preserve}.sql`, `.summary.md`) + 실제 PostgreSQL 시험 `tests/auth-handoff/bizreport-area-next-plan.test.mjs`. **적용 전 정지.**
- 앞 설계: [business-report.md](business-report.md)(사업 보고), [record-overlap.md](record-overlap.md)(기록 겹침 거르기), [project-3-levels.md](project-3-levels.md)(프로젝트 3단), [weekly-hwpx-draft.md](weekly-hwpx-draft.md)(주간보고 한글 파일), [weekly-report-hub.md](weekly-report-hub.md).
- 표시: **사실** = 저장소 코드·migration·문서로 확인(위치를 붙임). **추정** = 확인하지 못한 짐작.
- 공개 저장소라 실제 사업영역 이름·기록 내용은 쓰지 않는다.

---

## 0. 명진용 요약

**지금 문제.** 같은 일을 프로젝트 진행 기록과 사업 보고에 두 번 써서, 주간보고 ② 사업 요약 표와 ③ 회의·활동 결과에 겹쳐 나온다.

**합친 뒤.**

1. 기록은 **사업 보고 한 곳**에만 쓴다. 사업 보고에 **사업영역 꼬리표**(큰 프로젝트 › 하위 프로젝트)와 **다음 할 일** 칸이 생긴다.
2. 프로젝트 진행 기록 입력칸은 없앤다. 지금까지 쓴 진행 기록은 **지우지 않는다**(읽기만 남김).
3. [프로젝트] 메뉴는 없앤다(화면·주소 제거, 자료는 보존). 프로젝트 목록은 사업 보고 ⋯ → **[사업영역 관리]**(만들기·이름 바꾸기·순서)로 옮긴다. **지금 프로젝트 표를 그대로 사업영역 분류표로 쓴다**(새 표를 만들지 않음).
4. 사업 보고 화면 위 **[사업요약표 미리보기]**: 이번 주 사업 보고로 만든 한글 문서 모양 미리보기 → [HWP로 내려받기]·[기간 바꾸기].
5. 바구니의 '프로젝트로 보내기'는 **[사업 보고로 옮기기]**(이미 있음) / **[사업영역 꼬리표 달기]**로 바뀐다.
6. 자료실 프로젝트 폴더·일정·할 일에 붙은 프로젝트 연결은 지우지 않고 그대로 '사업영역'으로 읽는다.

**순서(4단계).** ① DB 칸 더하기(이번 PR, 적용 전 정지) → ② 화면(사업 보고에 칸, 미리보기, 바구니 문구) → ③ 옛 화면 제거(프로젝트 메뉴·진행 기록 입력칸, 자료 보존) → ④ 정리(남은 옛 읽기 경로 걷기, 제안만). 단계마다 일상어 3줄은 4절.

**명진이 정할 것은 7가지다(9절).** "전부 추천대로"라고만 답해도 된다.

---

## 1. 지금 구조: 프로젝트를 쓰는 곳 전부 (사실)

프로젝트 = `public.app_spaces` 행(위아래는 `parent_id`, 순서 `sort_order`, 최대 3단 `20261021053502_prj_depth_guard`, 휴지통 `deleted_at` `20261024193000_trash_projects_db`). 앱은 `metadata.project_system='v2'`(또는 `management_version=2`)인 행과 그 아래를 프로젝트로 본다(`app/project-catalog-model.mjs`). 이 트리가 이미 주간보고의 사업영역(1단) › 세부 과제(2단) › 사안(3단) 순서다(`app/journal-weekly.js` `placeRecords`, PRJ-재구성데이터).

### 1.1 프로젝트에 붙은 기록·자료

| 무엇 | 표·칸 | 쓰는 곳(파일) | 합친 뒤 |
| --- | --- | --- | --- |
| 프로젝트 진행 기록 | `app_project_progress_updates`(`project_id`, `summary`, `effective_on`=저장한 날) | 입력: 프로젝트 상세 `project-system-v3.js` `saveRecordInput`(746줄)·`saveProgressRecord`, 홈·업데이트 [기록할 곳] 한 곳 `update-places.js` 146줄 → `quick-save.js` `saveProjectProgress`. 읽기: `journal-data.js` 237줄(주간보고 ② 요약), `drive-summary.js`·Edge `drive-summary/core.mjs`, `ledger-browse.js`, `ledger-auto-model.mjs`·Edge `ai-assist`(원장 자동 기록 재료 `project_update`), `overlap-data.js`(겹침 판정), `record-saved.js` | **입력 경로 3곳 제거**, 표·기록 보존. 읽기는 3단계까지 지난 주 보기용으로 남김 |
| 진행상황·주요 일정·의견·블록 | `app_project_milestones`(일정 ↔ Google 일정 `google_event_id`), `app_project_comments`, `app_project_blocks`·`sections`·`modules`·`workstreams`·`checkitems` | 상세 `project-system-v3.js`, 일정 만들기 `calendar-plus.js` 157줄(`cmLinkBody`: 일정 → 프로젝트 주요 일정), 홈 `home-dashboard-v2.js` 69줄(다가오는 주요 일정 줄), `home-read.js`, `app.js` | 보존. 주요 일정 연결은 '사업영역' 연결로 그대로 읽음(1.3절) |
| 사업 보고 ↔ 프로젝트 | `app_meetings.project_id`(첫 프로젝트) + `app_record_links.source_meeting_id` 줄(여러 곳, `summary`=그 곳 요약, `20261023023500`) | `report-links.js`·`report-links-model.mjs`, 저장 함수 `app_meeting_set_links`(연결을 고칠 때 `project_id`를 '첫 연결 프로젝트'로 **다시 맞춤**, 마이그레이션 271줄), 프로젝트 상세 '사업 보고 N' | 3절: 꼬리표는 새 칸, 연결 줄은 담당조직 연결용으로 계속 |
| 바구니 업데이트 ↔ 프로젝트 | `app_record_links`(`note_id` → `project_id`), RPC `app_basket_confirm_links` | 분류 창 `basket-manual-link.js`, [기록할 곳] `update-places.js`·`home-quick.js`, 칩 `basket.js` 525·542줄('프로젝트' 칩), 바구니 묶기 `basket.js` 555줄 | 6절 |
| 할 일 ↔ 프로젝트 | `app_record_links`(`google_task_id` → `project_id`) | `google-tasks.js`, `home-quick.js` 187·213줄, `calendar-plus.js` 118줄(할 일 만들기 프로젝트 고르기), `task-layout.js` 20·36줄(할 일 목록 프로젝트 이름), `todo-radar-data.js` 138줄(챙길 것 → 할 일 연결), Edge `google-tasks` | 보존, 고르는 창 글자만 '사업영역'(7절) |
| 자료실 자료 | `app_documents.project_id` | 올리기 `library-upload.js`(`#docProject`), 고치기 `luEdit`, 사업 보고 자료 올리기는 보고의 `project_id`를 함께 보냄(204·319줄), 지우기 `document-delete.js`, Edge `library-files`·`meeting-files`·`document-actions`·`document-ai-index`·`workspace-drive` | 보존. 사업 보고 자료는 꼬리표를 함께 보내도록 화면에서 바꿈(7절) |
| 자료실 프로젝트 폴더 | `app_library_folders.project_id`(폴더 틀), `app_library_folder_items` | `library-folders.js`(같은 프로젝트 틀 안에서만 옮기기, 132·247줄), `library-tree.js` 56줄('프로젝트 없음' 틀), 묶기 칩 project(`20261028140000_library_view_group_order`) | 보존. 틀 이름만 '사업영역'(7절) |
| 공유 페이지 | `app_share_pages.project_id` | `share-pages.js` 37·112줄 | 보존 |
| 통화·텔레그램 소식 | `app_feed_items.project_id`·`suggested_project_id` | `feed-data.js`, Edge `collector-feed` | 보존 |
| 챙길 것 후보 | `project_id` | `todo-radar-data.js`, Edge `ai-assist/todo-radar.ts` | 보존 |
| 원장 | `app_ledger_records.target_project_id` 등 | `ledger-browse.js`, Edge `ai-assist`(ledger_*), `drive-summary/ledger-export.mjs` | 보존(원장 규칙상 지우지 않음) |
| 검색 | 검색 함수 `kind='progress'`·`'milestone'` → `view:'projects'` | `global-search-model.mjs` 242줄 | 3단계에서 열 곳을 사업 보고·사업영역 관리로 바꿈 |
| 기타 Edge | `team-ai`(project_id), `page-ai-draft`, `meeting-ai-draft`·`meeting-ai-ingest`, `event-media` | — | 영향 없음(새 칸은 비어도 됨) |

### 1.2 주간보고(업무일지 [주간 정리]·초안 복사·한글 파일)

- 모델 한 곳: `journal-weekly.js` `weeklySummary`. 화면 `renderWeekly`, 초안 복사 `weeklyReportText`, 한글 파일 `journal-hwpx.js`가 모두 이 결과를 쓴다(사실).
- ② 사업 요약 표(`summary` 묶음) = **프로젝트 진행 기록 + 바구니 프로젝트 연결 + 프로젝트 자료**를 `placeRecords`가 프로젝트 트리 순서로 사업영역 › 세부 과제 줄에 놓는다(203·231~241줄). 사업 보고는 여기 들어가지 않는다.
- ③ 회의·활동 결과(`meetings` 묶음) = 사업 보고를 날짜순(`meetingLine`), 종류 칩 `[언론]` 등(BIZ 결정 3).
- 한글 파일의 담당 팀원 칸은 직전 주 확정본 표기(내 줄은 그대로, `journal-hwpx.js` 머리 주석).
- 겹침 거르기(MTG-기록겹침거르기 4단계)가 이미 모델 안에 있다: 저장된 same 판정으로 겹친 줄을 ② 또는 ④에서 뺀다(`planOverlaps`).

### 1.3 일정·할 일 연결 요약

| 연결 | 저장 | 화면 |
| --- | --- | --- |
| Google 일정 → 프로젝트 주요 일정 | `app_project_milestones`(`google_event_id`, `project_id`) | 일정 만들기 창 [프로젝트] 고르기(`calendar-plus.js` 63~70줄) |
| 할 일 → 프로젝트 | `app_record_links`(`google_task_id`, `project_id`) | 할 일 만들기·편집, 홈 빠른 할 일, 챙길 것 |
| 사업 보고 후속 할 일 → 보고·프로젝트 | `app_record_links` 두 줄(`meeting_id`, `project_id`) | 사업 보고 입력 창(`team.js`) |

---

## 2. 합친 뒤 모양

```
사업 보고 화면
  [사업요약표 미리보기]  ⋯ → [사업영역 관리]
  ◀[전체][회의][정책][교섭][언론]…▶
  10.27 [언론] 철도 기자회견        가 사업영역 › 세부 과제 1
        다음 할 일: 후속 면담 일정 잡기
```

- **사업영역 = 지금 프로젝트 표 그대로**: 1단 = 사업영역, 2단 = 세부 과제, 3단 = 사안. 이름·순서·색·접어 두기·휴지통 모두 지금 기능이 그대로 쓰인다. 새 분류표를 만들지 않는다(AGENTS.md 4절 "같은 목적 표 먼저").
- **꼬리표는 한 보고에 하나**(사업 요약 표의 한 칸). 담당조직 연결(여러 곳)은 지금처럼 연결 줄로 한다.
- **다음 할 일**은 글 한 칸(1000자 이하). 사업 요약 표의 '이후 계획'으로 들어간다. Google 할 일을 만드는 것은 지금 [후속 할 일]이 따로 한다(9절 질문 4).

---

## 3. DB (이번 PR, 적용 전 정지)

### 3.1 무엇을 더하나

| 칸 | 모양 | 뜻 |
| --- | --- | --- |
| `app_meetings.business_area_id` | `uuid`, 비어도 됨, 외래키 `app_meetings_business_area_id_fkey` → `app_spaces(id)` **on delete set null** | 사업영역 꼬리표. 프로젝트를 영구 삭제하면 꼬리표만 비워지고 보고는 남는다. 휴지통에 넣으면 꼬리표는 그대로(되살리면 다시 보임) |
| `app_meetings.next_plan` | `text`, 비어도 됨, 검사 `app_meetings_next_plan_check`(1000자 이하) | 다음 할 일(= 이후 계획) |
| 정책 `app_meetings_business_area_ws` | **좁히기 전용(restrictive)**, authenticated, `business_area_id is null or private.app_space_in_workspace(business_area_id, workspace_id)` | 다른 업무공간의 프로젝트를 꼬리표로 달지 못하게(읽기·쓰기 모두). 기존 정책(`task12a_owner_all`, `app_meetings_trash_hidden`)은 그대로 |

- grant 추가 없음(표 단위 권한 그대로 → 새 칸도 소유자만 읽고 씀). 함수·트리거·색인 없음. 기존 행·기존 칸·연결 줄은 바꾸지 않고, 새 칸은 모두 빈 채로 시작한다(채우기 없음).
- 같은 업무공간 확인은 `20261023023500`의 `record_links_source_meeting_ws`와 같은 모양이다.

### 3.2 왜 `project_id`를 꼬리표로 쓰지 않나

- `app_meetings.project_id`는 연결 저장 함수 `app_meeting_set_links`가 연결을 고칠 때마다 **'첫 연결 프로젝트'로 다시 맞추고**, 프로젝트 연결이 없으면 비운다(마이그레이션 `20261023023500` 271줄). 명진이 고른 분류를 담으면 담당조직 연결을 고칠 때 꼬리표가 바뀌거나 지워진다.
- 함수를 고쳐 그 동작을 없애는 방법도 있지만, 지금 읽는 곳(프로젝트 상세·`team-ai`·`drive-summary`·검색 함수·`report-links.js` 옛 경로)이 그 칸을 '연결'로 읽고 있어 바꾸는 폭이 더 크다.
- 그래서 칸을 하나 더하고, **꼬리표가 비어 있는 옛 보고는 화면이 `project_id`를 꼬리표처럼 보여 준다**(읽을 때만, 저장하지 않음). 명진이 보고를 열어 꼬리표를 고르면 그때 `business_area_id`에 저장된다. 일괄 채우기를 하지 않는 이유: 채우면 모든 보고의 `updated_at`이 바뀌어 원장 자동 기록·AI 요약·겹침 판정 지문이 한꺼번에 '새로 고친 보고'로 보인다.

### 3.3 적용 경로와 되돌리기

- 경로: 승인형 DB workflow **확장 규칙**(restrictive 정책 1개, grant 0) — 로컬에서 `prepareMigration`으로 확인: apply·dry-run 모두 `rules=expanded`, `flow=full`, 대상 표 `app_meetings` 하나. 거절되면 폰 경로 C(SQL Editor).
- 사전 확인: 새 칸·검사·외래키·정책 없음, `private.app_space_in_workspace`가 SECURITY DEFINER, RLS 켜짐, anon·PUBLIC 권한 없음, 넓히는 정책은 task12a 하나. 다르면 아무것도 안 바꾸고 멈춘다.
- 사후 확인: 칸 두 개(빈 값)·외래키(on delete set null)·검사·정책 모양이 기록과 맞고, 다른 칸·다른 검사·색인·권한·다른 정책·트리거 해시와 행 수가 사전과 같다.
- 되돌리기: 짝 rollback은 **SQL Editor 전용**(drop policy는 workflow rollback 허용 목록 밖). 꼬리표나 다음 할 일이 하나라도 저장돼 있으면 멈춘다 → preserve SQL로 보관 → 화면을 칸 없는 판으로 → 비우기는 별도 승인 SQL → rollback.
- 시험: `tests/auth-handoff/bizreport-area-next-plan.test.mjs`(CI 실제 PostgreSQL 17) — 계획 확인, 사전 확인, 넓히는 정책이 하나 더 있으면 멈춤, dry-run 무변화, apply·사후 확인, 재적용 거절, 소유자 저장·1000자 한도·다른 업무공간 프로젝트 거절(42501)·없는 프로젝트 거절(23503)·남의 보고 못 봄·anon 거절, 프로젝트 영구 삭제 때 꼬리표만 비워짐, rollback 차단·preserve·rollback 뒤 snapshot 동일·재적용. 이 세션에서는 PostgreSQL 16으로 같은 SQL을 손으로 돌려 사전·적용·사후·경계·rollback·snapshot 동일까지 확인했다(npm 설치가 막혀 시험 파일 자체는 CI에서 처음 돈다).

---

## 4. 단계 (Expand → 화면 → 옛 화면 제거 → 정리)

### 1단계 — DB 칸 더하기 (이번 PR)

- 무엇이 바뀌나: 사업 보고에 '사업영역 꼬리표'와 '다음 할 일' 빈 칸이 생긴다. 화면은 아직 이 칸을 쓰지 않는다.
- 잘못되면: 사전·사후 확인에서 멈추면 아무것도 안 바뀐다. 적용 뒤에도 지금 화면은 새 칸을 모르므로 사업 보고·주간보고는 그대로 동작한다.
- 되돌리는 법: SQL Editor에서 짝 rollback(값이 저장돼 있으면 멈추고 preserve 먼저).

### 2단계 — 화면 (다음 세션, DB 적용 뒤)

- 사업 보고 입력·결과 창에 [사업영역] 고르기(공용 `choice-sheet.js` `projectRows`, 3단 트리, 하나만)와 '다음 할 일' 한 줄 칸. 목록 줄에 `사업영역 › 세부 과제` 작은 글자.
- [사업요약표 미리보기](5절)·AI 한 줄 요약(6절, Edge 배포 필요 — 별도 정지 지점).
- 주간보고 모델: ② 사업 요약 표의 재료에 **꼬리표 단 사업 보고**를 더한다. 진행 칸 = 그 사업영역의 그 주 사업 보고 AI 한 줄(없으면 보고 제목들), 이후 계획 = 다음 할 일. 옛 진행 기록·바구니 프로젝트 연결은 **그 주에 이미 있던 것만** 그대로 함께 보인다(지난 주 보고서가 달라지지 않게).
- 바구니: [사업영역 꼬리표 달기](6절). [사업 보고로 옮기기]는 이미 있음(`basket.js` 446줄).
- 사업 보고 ⋯ → [사업영역 관리]: 지금 프로젝트 목록 화면의 만들기·이름 바꾸기·순서·접어 두기를 **그대로 불러 쓰는** 창(새로 만들지 않음, `project-system-v3.js`·`project-order.mjs`·`project-fold.mjs` 재사용).
- 일상어 3줄: 무엇이 바뀌나 — 사업 보고에 꼬리표·다음 할 일 칸과 미리보기 버튼이 생긴다. / 잘못되면 — 칸이 서버에 없으면(400) 칸을 숨기고 지금처럼 동작한다. / 되돌리는 법 — 화면 PR을 되돌리면 된다(데이터는 그대로).

### 3단계 — 옛 화면 제거 (자료 보존)

- 지울 것: [프로젝트] 메뉴(사이드바·폰 [메뉴] 창·하단바 설정 `menu_layout`), `?view=projects` 화면, 프로젝트 상세의 기록 입력칸, [기록할 곳] 창의 프로젝트 줄(진행 기록 저장 `saveProjectProgress` 경로), 홈 프로젝트 카드 중 진행 기록 입력. 옛 주소 `?view=projects`·`?project=`는 사업 보고(그 사업영역 거르기)로 연다.
- 남길 것: 모든 표·기록, 사업영역 관리 창, 주요 일정·자료·폴더·할 일 연결 읽기.
- 일상어 3줄: 무엇이 바뀌나 — 프로젝트 메뉴와 진행 기록 입력칸이 사라지고, 옛 링크는 사업 보고로 열린다. / 잘못되면 — 옛 진행 기록을 볼 곳이 없어질 수 있어, 사업영역 관리 창에서 '지난 진행 기록 보기'(읽기만)를 남긴다. / 되돌리는 법 — 화면 PR 되돌리기(데이터는 지운 적 없음).

### 4단계 — 정리 (제안만, 별도 승인)

- 옛 진행 기록을 읽는 경로(주간보고 ②의 진행 기록 재료, 원장 자동 기록 재료 `project_update`, `drive-summary`)를 걷을지는 몇 주 써 본 뒤 정한다. 표 삭제·칸 삭제는 하지 않는다(요청 없으면 데이터 보존).
- `app_meetings.project_id`와 `app_meeting_set_links`의 '첫 프로젝트 맞추기'는 꼬리표가 자리 잡은 뒤 Contract 후보로 제안만 한다(`docs/web2-expand-deploy-verify-contract.md`).
- 일상어 3줄: 무엇이 바뀌나 — 더 이상 쓰지 않는 옛 읽기 코드가 빠진다. / 잘못되면 — 옛 주의 보고서가 달라질 수 있어 먼저 대조표로 확인한다. / 되돌리는 법 — 코드 되돌리기.

---

## 5. [사업요약표 미리보기] · HWP 내려받기 흐름

1. 사업 보고 화면 위 [사업요약표 미리보기] → 기간 기본 = 이번 주(서울 월~일), [기간 바꾸기](달력 두 칸).
2. 미리보기 = **기존 주간보고 모델 `weeklySummary`를 그대로** 부른다(새 모델 만들지 않음). 위: 사업 요약 표(사업영역 › 세부 과제 › 진행·이후 계획 › 담당). 아래: 세부 보고(③ 회의·활동 결과, 날짜순 — 지금처럼).
   - 진행 = 그 사업영역(꼬리표)의 기간 안 사업 보고를 AI가 한 줄로(6절). AI가 꺼져 있거나 한도면 보고 제목을 `·`로 이음.
   - 이후 계획 = 그 보고들의 '다음 할 일'(최근 것 먼저, 줄바꿈).
   - 담당 = 비움(앱에 담당자 정보 없음, 내려받은 뒤 직접). 단, 한글 파일은 지금처럼 직전 주 확정본의 내 표기를 쓰는 기존 규칙이 있다 → 9절 질문 3.
3. [HWP로 내려받기] = 이미 있는 주간보고 한글 양식 경로(`journal-hwpx.js` + `weekly-hwpx/*.mjs`, 칸막이 엔진 `hwp-frame.js`)를 그대로 쓴다. 화면 모양만 '한글 문서처럼'(A4 폭 흰 종이, 표 테두리) 보여 준다.
4. 서버에 새로 저장하는 것은 없다(미리보기는 계산만). 고친 줄을 남기려면 기존 주간 임시저장(`weekly-draft-store.js`)을 쓴다.

---

## 6. AI 한 줄 요약 (ai-assist)

- 새 쓰임 `kind:"area_week_summary"`(이름 안) — 기존 `ai-assist` 안에서. 앱은 **기간과 사업영역 id만** 보내고, 서버가 로그인 토큰으로 그 보고들을 읽는다(글을 앱이 보내지 않음, `org-summary.ts`·`ledger_auto`와 같은 방식).
- 비용: 기존 월 상한 `MONTHLY_LIMIT_KRW`(handler.ts 106줄)와 사용량 기록 `writeUsage`(`app_ai_daily_usage`) 안에서만 돈다. 쓰임별 하루 횟수 한도(예: 하루 30회)를 둔다. 실패·한도면 제목 잇기로 대신한다.
- 같은 결과 다시 쓰기: 그 주·그 사업영역·보고 지문이 같으면 다시 부르지 않는다. 저장 위치는 2단계 설계에서 정한다 — 기존 주간 임시저장 칸(`app_weekly_exec_requests.draft`)에 넣으면 DB 변경이 없다(추천, 9절 질문 5).
- Edge 배포는 별도 정지 지점(§8 workflow, `ai-assist` verify_jwt 그대로).

---

## 7. 바구니·자료실·일정·할 일

| 곳 | 지금 | 합친 뒤 |
| --- | --- | --- |
| 바구니 분류 창(프로젝트·담당조직 고르기) | 프로젝트를 고르면 업데이트 → 프로젝트 연결 줄(`app_basket_confirm_links`), 주간보고 ②에 진행 기록처럼 들어감 | 프로젝트 줄 이름을 **[사업영역 꼬리표 달기]**로. 저장 방식은 같은 연결 줄(DB 변경 없음). 주간보고에서는 2단계 규칙대로 ②에 '그 주에 있던 것'으로 남음. 새로 쓸 일은 [사업 보고로 옮기기] 권장 문구 |
| 바구니 [사업 보고로 옮기기] | 있음(`basket.js` 446줄), 업데이트 → 보고 연결 줄 | 옮길 때 사업영역 꼬리표도 고르게(업데이트에 프로젝트 연결이 있으면 그걸 미리 고름) |
| 자료실 프로젝트 폴더·묶기 칩 | `project_id` 틀 | 그대로. 글자만 '사업영역' |
| 자료 올리기 [프로젝트] 칸 | `#docProject` | 그대로, 글자만. 사업 보고에서 올리면 꼬리표를 `project_id`로 함께 보냄(지금은 보고의 `project_id`) |
| 일정 만들기 [프로젝트] → 주요 일정 | `app_project_milestones` | 그대로, 글자만 '사업영역'. 홈 '다가오는 주요 일정' 그대로 |
| 할 일 [프로젝트] 연결 | 연결 줄 | 그대로, 글자만 |

---

## 8. MTG-기록겹침거르기는 필요 없어지나

- **새로 생기는 겹침은 대부분 사라진다**: 진행 기록 입력칸이 없어지면 "사업 보고 ↔ 프로젝트 진행 기록" 겹침(이 설계의 주된 대상)은 더 생기지 않는다.
- **남는 겹침**: ① 이미 저장된 지난 진행 기록 ↔ 사업 보고(지난 주 보고서), ② 담당조직 기록 ↔ 사업 보고(④ 산하 조직 현황), ③ 바구니 업데이트 ↔ 사업 보고. 이미 만든 판정 표·주간보고 거르기·저장 뒤 알림은 이 세 경우에 계속 쓸모가 있다.
- **판단(추천)**: 이미 만든 것(DB·Edge `overlap_check`·저장 뒤 알림·주간보고 거르기·원장 합치기 #1259)은 **그대로 둔다**. 남은 일 중 **프로젝트 진행 기록 저장 경로 연결은 하지 않는다**(3단계에서 입력칸이 사라짐). 5a(ledger_auto 짝 읽기 Edge)는 원장 겹침용이라 별도 판단. 원장 행은 "진행중 → 남은 일 축소"로 커맨드센터가 정리.

---

## 9. 명진이 정할 것 (추천과 함께)

각 항목에서 **굵은 것이 추천**이다.

1. **꼬리표 개수** — **가. 보고 하나에 하나(추천)**: 사업 요약 표 한 칸에만 나와 겹치지 않는다. · 나. 여러 개(같은 보고가 여러 칸에 나옴 = 지금 문제 재발).
2. **옛 보고의 꼬리표** — **가. 일괄로 채우지 않고, 꼬리표가 빈 옛 보고는 지금 연결된 첫 프로젝트를 꼬리표처럼 보여 줌(추천, 3.2절)** · 나. DB에서 한 번에 채우기(별도 DB 단계, 모든 보고의 '고친 시각'이 바뀜).
3. **담당 칸** — **가. 미리보기 화면은 비우고, HWP 파일은 지금처럼 직전 주 확정본의 내 표기를 넣음(추천, 기존 규칙 유지)** · 나. 둘 다 비움(요청 원문대로, 내려받은 뒤 직접).
4. **다음 할 일 → Google 할 일** — **가. 글 칸만(추천)**: 할 일은 지금 [후속 할 일]로 따로 만든다. · 나. 다음 할 일 줄마다 [할 일로] 버튼.
5. **AI 요약 다시 쓰기 저장 위치** — **가. 기존 주간 임시저장 칸(추천, DB 변경 없음)** · 나. 새 표(DB 단계 하나 더).
6. **지난 진행 기록 보기** — **가. [사업영역 관리] 안에 '지난 진행 기록'(읽기만) 접힌 칸(추천)** · 나. 보이지 않게(데이터만 보존).
7. **주간보고 ②에 바구니 프로젝트 연결** — **가. 그대로 들어감(추천, 지난 주 보고서 유지)** · 나. 합친 뒤부터는 꼬리표 단 사업 보고만.

---

## 10. 범위 밖 발견사항 (고치지 않음)

- `docs/migration-history.md`에 `20261028160000_ai_usage_costs`·`20261028170000_note_folders` 행이 없다(다른 PR 범위). 이 PR도 같은 파일 충돌을 피하려고 행을 더하지 않았다 — 커맨드센터 원장 정리 때 함께.
- 로컬 `node --test tests/security/*.test.mjs`에서 Deno가 필요한 `real Deno provider location contract` 6건이 이 세션 환경에서 실패했다. 시험 이름대로 실제 Deno 실행 파일이 필요한 시험이고 이번 변경(SQL·문서·DB 시험)과 닿는 곳이 없다(추정, clean main 재현은 하지 않음 — CI 결과로 판단).

---

## 11. 2단계 화면 구현 기록 (MTG-프로젝트합치기 2단계 PR)

명진 결정(요청함 10/28 19:38): ① 꼬리표 하나 ② 옛 보고는 첫 연결 프로젝트를 화면에서 꼬리표처럼(일괄 채우기 없음) ③ 미리보기 담당 칸 비움·HWP는 기존 규칙 ④ 다음 할 일은 작게 접힌 칸 + 줄마다 [할 일로](자동 동기화 없음) ⑤ AI 요약 고친 내용은 주간 임시저장 칸 ⑥ 지난 진행 기록 보기 화면은 만들지 않음(데이터 보존) ⑦ 바구니 프로젝트 연결은 주간보고 ②에 그대로.

| 무엇 | 어디 | 비고 |
| --- | --- | --- |
| 규칙 한 곳 | `app/business-area-model.mjs` | 꼬리표(`shownArea`: 직접 단 것 → 없으면 `project_id` 빌림), 다음 할 일 줄·1000자, 주·경로, 미리보기 재료, 주간보고 ② 재료, 사업영역 칩 |
| 쓰기 창·고치기 창 칸 | `app/business-area-fields.js` `mountAreaFields` (team.js `#meetingAreaFields`, meeting-round-detail.js `#mrdEditArea`) | [사업영역] 고르기 = `report-places-sheet.js` `pickBusinessArea`(공용 고르기 창 `projectRow`, 하나만). [연결할 곳]에서 프로젝트를 고르면 손대지 않은 꼬리표를 첫 프로젝트로 미리 고름. 칸이 서버에 없으면(400) 숨김 |
| 보기 면 | `paintAreaView` (`#mrdAreaView`) | '사업영역 …' 한 줄(빌린 것은 "(연결에서)"), 다음 할 일 줄마다 [할 일로] = 기존 `google-tasks?action=create`(보고·사업영역 연결 줄 함께), 이어진 할 일과 글이 같으면 '할 일에 있음' |
| 목록·칩 | team.js `reportRows`·`meetingColumnList` 한 곳에서 거름 | 칸 칩 아래 사업영역 칩([전체]·1단·[꼬리표 없음 n]). 목록 줄 작은 글자는 직접 단 꼬리표만 |
| [사업요약표 미리보기] | `app/report-summary-preview.js` | 사업 보고 화면이 읽어 둔 보고로 계산만(저장 없음). 표 줄 세우기 = 주간보고 `placeRecords`, 보고 한 줄 = `meetingLine`(시각 뺌). ‹ › 주 넘기기·[기간 바꾸기]. 줄을 누르면 그 보고. [HWP로 내려받기] = 그 주 [주간 정리]의 기존 한글 파일 상자(`KPTUJournal.showWeek(day,{hwpx:true})`) |
| ⋯ [사업영역 관리] | index.html `#reportMore`(`<details>`) | 지금 프로젝트 화면(만들기·이름·순서·접기 그대로)으로 간다. 3단계에서 프로젝트 메뉴를 걷을 때 이 창 안으로 옮긴다 |
| 주간보고 ② | `journal-weekly.js` summary | **직접 단 꼬리표**의 사업 보고만 "보고 → 이후: 다음 할 일"로 사업영역 줄에. 옛 보고는 넣지 않음(지난 주 보고서 유지). `readWeekMeetings`가 두 칸을 함께 읽음(없으면 400 → 지금처럼) |
| 바구니 | `basket-manual-link.js` | [연결하기] 창의 '프로젝트 고르기' → **[사업영역 꼬리표 달기]**(저장은 같은 연결 줄). [사업 보고로 옮기기]는 이미 있음 |

남은 것: 사업영역 AI 한 줄 요약(`ai-assist`, Edge 별도 PR·배포 전 정지)과 그 고친 내용 저장(주간 임시저장 칸), 쓰기 창의 AI 사업영역 추천, 3단계(옛 프로젝트 메뉴·진행 기록 입력칸 제거, ⋯ [사업영역 관리] 창을 사업 보고 안으로), 바구니·자료실·일정의 나머지 '프로젝트' 글자.
