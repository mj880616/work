# 묶음A 조사·설계: 19 협업 장치 전체 목록 · DB-1 · TASK-설계 · 업무 인박스 구조

- 조사일: 2026-09-26
- 기준: `main` `806591e` (#318 포함)
- 세션: 로컬. production은 Supabase MCP read-only 조회(`execute_sql` SELECT, `query_logs`)와 `supabase functions list`만 사용했다. 코드·DB·Edge·OAuth 설정 변경 없음.
- 행 수는 조사 시점 값이다. 계정은 역할(소유자·보조 관리자·비구성원)로만 적는다.
- 이 문서는 조사·설계만 담는다. SQL은 초안이며 실행하지 않았다.

## 0. 요약

- 협업 장치는 화면에서는 대부분 이미 꺼졌거나 막혀 있지만, 코드·DB·Edge에는 넓게 남아 있다. 제거 담당 작업별로 1절 표에 나눴다.
- DB-1의 두 반복 오류는 이미 멈췄다. 원인 코드가 #226·#250에서 제거됐고, 이후 로그에 0건이다. 대신 현재 진행형 오류 1건을 새로 찾았다: 팀 AI 대화 메시지 저장이 매번 실패한다(2절).
- Google Tasks 연동은 새로 만들 필요가 거의 없다. `google-tasks` Edge Function(v6)이 이미 목록·생성·수정·완료·삭제를 하고, 일정과 같은 Google 연결(토큰)을 쓴다. Web2가 새로 보관할 것은 "Google 할 일 ID ↔ 프로젝트·회의·담당조직" 연결 1종뿐이다(3절).
- 업무 인박스는 기존 표를 넓혀 쓰기 어렵다. 새 표 2개(메모 원문 1개, 연결 1개)가 최소안이다. 연결 표를 Google 할 일 연결과 함께 쓰면 DB 변경을 한 번으로 줄일 수 있다(4절).
- 현재 팀 AI는 원문을 OpenAI(Responses API, `store:false`)로 보낸다.

## 1. 19 협업 장치 전체 목록 (26 조사 겸함)

### 1.1 활성 여부 판단 기준

Web2 진입 경로 `app/index.html → app.js → loader-v2.js → view-loader.js`에서 참조를 재귀로 따라가 실제로 불러오는 파일을 구분했다.

- 활성(로드됨): `loader-v2.js`·`view-loader.js`가 부르는 파일.
- 비활성(로드 안 됨, 앱 루트에 남음): `auth-login-fallback.js`, `auth-ui.js`, `brand-logo.js`, `calendar-move.js`, `home-dashboard-v2.js`, `media-workflow.css`, `member-default-role.js`, `myspace-return.js`, `password-reset.js`, `profile-settings.js/.css`, `project-archive.js`, `project-deeplink.js`, `project-delete.js`, `project-empty-workstream-guard.js`, `project-files.js`, `project-hide-legacy.js`, `project-modal-polish.js`, `project-modal-scroll-lock.js`, `project-operating-model.js`, `project-suborganization-links.js`, `project-task-link.js`, `project-templates.js`, `project-type-labels.js`, `project-update-actions.js`, `task-completed-label.js`, `task-notes.js`, `task-project-routing.js`, `task-title-ui.js`, `team-member-management.js/.css`, `team-member-overview.js/.css`, `team-profile-view.js/.css`, `workflow-ai-v3.js`.
  - `page-design-core.js`, `public-page-auth.js`, `public-page-editor.js`, `web1-admin-auth.js`, `web1-page-capabilities.js`는 Web2에서는 안 쓰지만 Web1 공개 페이지가 쓴다. 제거 대상 아님.
  - 비활성 파일 대부분은 `.github/workflows/app-smoke-check.yml`, `tests/app-e2e/*-fixture.html`이 여전히 참조한다. 파일을 지울 때 이 검사·fixture도 함께 정리해야 한다.

### 1.2 가입·초대·접근요청·관리자 지정 → 20 (화면·코드), 27·28 (DB)

| 구분 | 위치 | 현재 상태 | 제거 시 영향·의존 |
| --- | --- | --- | --- |
| 화면 | `app/index.html` `#authView`(계정 만들기 탭, `#inviteNotice`) | 표시 안 됨(로그인은 `app/login/`로 이동). 마크업만 남음 | 없음. `team.js`의 `setAuthMode`·`#inviteNotice` 참조 함께 정리 |
| 화면 | `app/index.html` `#bootstrapView`("FIRST ADMIN 첫 관리자 등록") | 구성원 행이 없는 계정이 로그인하면 표시됨 | `team.js` `showOnly('bootstrapView')`·`#bootstrapBtn`, `loader-v2.js`의 `teamState==='bootstrap'` 분기와 함께 제거. 제거 후 비구성원 로그인 시 보여줄 화면(안내 후 로그아웃) 필요 |
| 화면 | `app/index.html` 끝 `/auth/v1/signup` fetch 가로채기 스크립트 | 활성(가입 요청에 복귀 주소를 붙임) | 가입 제거 시 함께 제거 |
| 화면 | `app/login/index.html`·`login.js` 계정 만들기 탭, `invite` 파라미터 | 활성(가입 가능) | 로그인만 남김. Supabase Auth 가입 허용 설정은 읽생기와 공유이므로 대시보드 설정은 바꾸지 않는다(1.8) |
| 코드 | `app/auth-service.js` `signUp`, `app/confirmed.html` | 활성 | 로그인 화면의 가입 탭 제거와 함께 |
| 코드 | `app/team.js` `acceptInviteIfPresent` → `rpc app_accept_invite` | 활성 호출이지만 DB 실행권한이 회수되어 항상 실패(`?invite=` 있을 때만) | 제거 |
| 코드 | `app/team.js` `#bootstrapBtn` → `rpc app_claim_owner` | 실행권한 회수로 항상 실패 | 제거 |
| 코드 | `app/access-approval.js/.css` (bootstrap 상태에서 로드) | 접근요청 생성(`app_request_workspace_access`)은 권한 회수로 실패. 승인·거절 RPC는 아직 실행 가능 | 제거. `index.html` preload, `app-smoke-check.yml` 참조 정리 |
| 코드 | `team-member-management.js`, `team-member-overview.js`, `team-profile-view.js`, `member-default-role.js` | 비활성 | 파일·fixture·`team-member-overview-e2e.yml`·smoke 참조 정리(31과 겹침, 20에서 처리 권장) |
| 테스트 | `tests/app-e2e/access-request-push.spec.mjs`, `solo-shell.spec.mjs`, `workspace.spec.mjs`(초대 수락 흐름), `team-member-management.spec.mjs`, `tests/domain/web2-auth-origin.test.mjs`(signup) | CI 대상 | 화면 제거와 같은 PR에서 기대값 변경 |
| DB 표 | `app_access_requests` 2행(승인 1, 대기 1), `app_invites` 0행, `app_bootstrap_tokens` 1행, `app_groups`·`app_group_members` 0행 | 사용 안 함 | 27에서 삭제. `app_access_requests.invite_id → app_invites` FK |
| DB 함수 | `app_accept_invite`, `app_claim_owner`, `app_request_workspace_access`, `app_join_default_team`, `app_respond_project_invitation` | authenticated 실행권한 없음 | 27에서 삭제 |
| DB 함수 | `app_approve_access_request`, `app_reject_access_request`, `app_create_invite`, `app_set_workspace_member_role` | **authenticated 실행 가능**. 소유자만 통과(`app_is_workspace_admin`이 소유자 확인으로 바뀜) | 대기 중인 접근요청 1건을 소유자가 승인하면 구성원이 늘어난다. 27에서 삭제 전까지 20에서 화면 경로만 먼저 없앤다 |
| DB 트리거 | `app_workspace_members.trg_app_enforce_workspace_member_role` | 활성. 특정 계정 이메일을 코드에 고정해 owner를 부여 | 28에서 역할 체계와 함께 정리 |
| DB 정책 | `app_access_requests_read`, `app_groups_*`, `app_group_members_*` | `app_is_workspace_member`·`app_is_workspace_admin` 사용 | 표 삭제와 함께 |

### 1.3 할 일 배정 → 21 (코드), 29 (DB). Web2 자체 할 일 전체는 1.9

| 구분 | 위치 | 현재 상태 | 제거 시 영향·의존 |
| --- | --- | --- | --- |
| DB 열 | `app_tasks.assignee_id`, `assignment_status`, `assignment_responded_at` | 모든 행이 `accepted`. 담당자 선택 UI는 #250에서 제거 | Web2 할 일 전체 삭제(29)로 함께 사라짐 |
| DB 트리거 | `app_tasks.trg_app_prepare_task_assignment` (`public.app_prepare_task_assignment`) | 활성, 항상 accepted로 덮어씀 | 29 |
| DB 정책 | `app_tasks.task12a_owner_all` WITH CHECK의 `app_user_in_workspace(assignee_id, …)` | 활성 | 29 |
| 코드 | `task-layout.js`(`assignee_id=eq.나`로 조회, 저장 시 자기 자신 지정), `meeting-round-detail.js`(후속 할 일에 자기 지정), `project-system-v3.js`(할 일 개수 `assignee_id=eq.나`) | 활성 | 21에서 Google Tasks로 바꾸며 제거 |
| Edge | `team-ai`(personal 범위가 `assignee_id`·`app_event_attendees` 조회), `meeting-ai-draft`(`assignee_id`, `app_space_members`) | 배포됨 | 25·23. 표 삭제(29) 전에 Edge에서 참조를 먼저 없애야 함 |
| 데이터 | 비구성원 계정에게 배정된 미완료 할 일 1건(회의 후속) | 소유자 화면에 안 보임 | 29 삭제 대상. 필요한 내용이면 사용자가 먼저 Google Tasks로 옮김 |
| 테스트 | `supabase/tests/authz_task_assignee.sql`, `tests/app-e2e/task-layout-groups.spec.mjs` 등 | CI 대상 | 21·29 |

### 1.4 일정 참석자·초대 → 22

| 구분 | 위치 | 현재 상태 | 제거 시 영향·의존 |
| --- | --- | --- | --- |
| DB 표 | `app_event_attendees` 0행 | 정책 `task12a_owner_all` | 22에서 코드 제거 후 27에서 표 삭제 |
| DB 트리거 | `app_events.trg_app_add_event_creator_attendee` | **활성**. Web2 일정 1건 저장마다 참석자 행을 만든다(현재 `app_events` 0행이라 쌓인 것 없음) | 22에서 트리거 제거 SQL 필요(DB 변경, 정지 지점) |
| 코드 | `calendar-move.js`, `team-profile-view.js` | 비활성 | 파일·fixture(`calendar-move-fixture.html`, `calendar-move.spec.mjs`) 정리 |
| Edge | `team-ai` personal 범위 | 배포됨 | 25 |
| 테스트 | `calendar-personalization.spec.mjs`, `meeting-entry.spec.mjs`, `project-system-v3.spec.mjs`, `workflow-ai-model.spec.mjs`, `workspace.spec.mjs`, `tests/security/document-edge-authz.test.mjs` | 참석자 모의 응답 포함 | 22 |
| 부속 | `app_event_comments`·`app_event_photos` 0행 | `photo-room.js`(활성)가 사용 | 협업이 아니라 일정 부속 기능. 22 대상 아님 |

### 1.5 프로젝트 멤버·초대 → 23

| 구분 | 위치 | 현재 상태 | 제거 시 영향·의존 |
| --- | --- | --- | --- |
| DB 표 | `app_space_members` 0행, `app_project_invitations` 0행 | 정책 다수(`app_can_manage_space`, `app_is_workspace_member`) | 27 |
| DB 트리거 | `app_project_invitations.app_project_invitations_workspace_consistency` | 공용 함수 `app_enforce_workspace_links` 사용 | 표 삭제 시 트리거만 사라짐. 함수는 다른 표가 계속 사용 |
| DB 함수 | `private.app_can_view_space/edit_space/manage_space` | 이미 `owner_id = 나`로만 판단 | 유지(이름만 옛 구조) |
| DB 정책 | `app_spaces_create`: `app_role_rank(app_workspace_role(...)) >= 20` | 역할 등급 기반. 보조 관리자 계정도 자기 소유 프로젝트 생성 가능 | 28에서 owner 확인으로 교체 |
| Edge | `meeting-files`·`meeting-ai-draft`의 `app_space_members` 조회, `library-files` `canEditProject`(구성원 role 조회) | 배포됨 | 23. 비고의 "보관 프로젝트 서버 거부"는 `library-files`·`meeting-files` `canEditProject`에 status 확인을 더하는 일 |
| 코드 | `project-templates.js`, `project-suborganization-links.js`(비활성) | 비활성 | 31 |
| 문서 | `app/ARCHITECTURE.md` 5절·8절의 `notification-center-ui.js`(프로젝트 초대 수락) | 파일 없음 | 범위 밖 발견사항(5절) |
| 테스트 | `supabase/tests/authz_project_invitations.sql`, `authz_membership_invites.sql` | CI 대상 | 23·27 |

### 1.6 담당조직 이중 저장 → 24

같은 "내가 맡은 조직" 정보가 세 곳에 있다.

| 저장 위치 | 행 수 | 쓰는 곳 |
| --- | --- | --- |
| `app_suborganization_assignees`(조직↔사용자) | 13(모두 소유자) | `suborganizations.js`(활성: 담당자 지정 모달·필터), `workplace-detail.js`(활성: 편집 권한 판단), `private.app_can_edit_suborganization` |
| `app_profile_workplaces`(사용자별 조직 이름 목록, `organization_id` 연결) | 12(모두 소유자, 전부 조직 연결됨) | `workplace-detail.js`(활성), `profile-settings.js`·`team-member-management.js`(비활성) |
| `app_suborganizations.default_assignee_name`(이름 문자열) | 93/94 | `suborganizations.js` 칩 표시 |

- 동기화 트리거 3개: `app_profiles.app_profiles_claim_named_suborganizations`(표시 이름이 조직의 기본 담당자 이름과 같으면 두 표에 자동 추가), `app_profile_workplaces.app_profile_workplaces_link_org`, `app_suborganizations.app_suborganizations_sync_profile_name`.
- 빈 부속 표: `app_profile_workplace_statuses` 0, `app_profile_weekly_reports` 0, `app_profile_report_projects` 0.
- 제거 영향: 소유자 1인이면 "담당" 개념 자체가 필요 없다. 24에서 하나를 남기거나(권장: 둘 다 없애고 조직 목록 자체를 "내 조직"으로 봄) 필터 UI를 바꾸는 결정이 필요하다. `suborganization-filters-e2e.yml`, `profile-workplaces.spec.mjs` 등 테스트가 걸려 있다.

### 1.7 팀 AI → 25

| 구분 | 위치 | 현재 상태 |
| --- | --- | --- |
| Edge | `team-ai` v5, verify_jwt=false(함수 코드에서 인증) | 배포됨 |
| 화면 | `workplace-ai-report.js`(활성: 조직 "주간보고 초안", "타임라인 초안"), `project-operating-model.js`(비활성) | 조직 화면에서 사용 |
| DB | `app_ai_conversations` 4, `app_ai_messages` **0**, `app_ai_daily_usage` 6, `app_ai_workspace_settings` 1 | 2절 참고(메시지 저장 실패) |
| 역할 의존 | `team-ai`의 구성원 확인(`app_workspace_members`), 정밀 모드 `owner/admin` 확인, 프롬프트 문구 "공공기관사업팀 공동 업무" | 25에서 개인 업무 AI로 교체 |

원문 전송 경로(질문 추가분):

- 브라우저 → `POST /functions/v1/team-ai`(사용자 토큰) → Edge가 service role로 구성원·설정·사용량 확인, 사용자 토큰으로 문맥(프로젝트·자료·일정·회의, personal 범위는 할 일·참석 일정) 조회 → `https://api.openai.com/v1/responses`로 전송(`store:false`).
- 모델은 DB 설정값(`app_ai_workspace_settings.default_model`/`advanced_model`)이며 현재 OpenAI 모델이다.
- 조직 주간보고 초안은 조직 기록 원문(`raw_text`)을 프롬프트에 그대로 넣어 보낸다.
- 같은 OpenAI 경로를 쓰는 Edge: `meeting-ai-draft`, `meeting-ai-ingest`, `page-ai-draft`, `document-ai-index`, `library-files`(업로드 제목 추정). 모두 `store:false`.

### 1.8 보조 계정 → 30

- Auth 사용자 4명: 소유자 1(이메일 로그인), 보조 관리자 1(Google, 9/14 생성, `app_workspace_members` role=admin), 비구성원 2(Google).
- 보조 관리자가 가진 데이터: `app_profiles` 1행뿐. 할 일·자료·회의·조직·AI 기록 0. 읽생기 데이터 0.
- 비구성원 2명: 읽생기 데이터 0. 그중 1명은 **Google 캘린더 연결 행(토큰 포함)이 남아 있다**. 1명은 대기 중 접근요청과 연결된 것으로 보인다(추정).
- 쪽지 `app_direct_messages` 5행: 소유자와 현재 비구성원 사이. 화면은 제거됨.
- 보조 관리자가 아직 할 수 있는 것: `app_is_workspace_member`를 쓰는 정책(`app_internal_checklist_items` 0행 전체 읽기·쓰기, `app_groups` 읽기, `app_project_templates` 읽기), `app_spaces_create`로 자기 소유 프로젝트 생성. 소유자 데이터 접근은 불가.
- 제거 순서: 20·28에서 구성원 체계 정리 → 30에서 Auth 계정 삭제. Auth는 읽생기와 공유이므로 계정 삭제는 사용자 결정 후 대시보드에서 직접 한다. `app_tasks.assignee_id`는 `ON DELETE SET NULL`, 나머지 FK는 cascade 여부 확인 필요.

### 1.9 Web2 자체 할 일 (Google Tasks 교체 후 데이터째 삭제 예정)

| 구분 | 내용 |
| --- | --- |
| 데이터 | `app_tasks` 58행: 완료 56, 미완료 2(소유자 1: 하위 프로젝트 연결, 비구성원 배정 1: 회의 후속). `source_type` 없음 30·project 26·meeting 2. 프로젝트가 지워져 `project_id`가 빈 project 할 일 25 |
| 화면 | `index.html` 할 일 탭(`#tasks` 패널, `#quickTaskBtn`·`#newTaskBtn`), `task-layout.js/.css`, `task-row-view.js`, `task-workflow.js`(회의 화면이 로드), `google-tasks.js/.css`(Google 할 일 표시, 유지 대상) |
| 다른 화면의 할 일 | `team.js`(`loadAll`에서 전체 조회, 주간 미리보기), `project-system-v3.js`(상세의 할 일 목록·추가, 목록 개수 합계 #305), `meeting-round-detail.js`(후속 할 일 생성·조회), `project-catalog.js`/`library-upload.js`는 해당 없음 |
| 비활성 | `task-notes.js`, `task-project-routing.js`, `task-title-ui.js`, `task-completed-label.js`, `project-task-link.js`, `home-dashboard-v2.js`, `app/legacy/task-personal-due.js`, `home-task-actions.js` |
| DB | 표 `app_tasks`, 정책 `task12a_owner_all`, 트리거 3(`app_tasks_workspace_consistency`는 공용 함수라 트리거만 삭제, `app_tasks_child_project_guard`, `trg_app_prepare_task_assignment`), FK 5(모두 `app_tasks`에서 나가는 방향, 들어오는 FK 없음) |
| Edge | `team-ai`, `meeting-ai-draft`가 `app_tasks` 조회 |
| 테스트·CI | `task-visibility-observer-check.yml`, `browser-storage-audit.yml`, `app-smoke-check.yml`, `workspace.spec.mjs`(할 일 저장), `task-layout-groups.spec.mjs`, `home-dashboard-v2.spec.mjs`, `supabase/tests/authz_task_assignee.sql`, `authz_sole_owner.sql` |

### 1.10 읽생기(rtw_*)와 공유하는 DB 요소

읽생기 함수·정책 중 `app_*`를 참조하는 것은 없다(조회 확인). 공유 지점은 아래뿐이다.

| 요소 | 공유 방식 | 주의 |
| --- | --- | --- |
| `auth.users`와 Auth 설정(가입 허용, Google 로그인) | 두 제품이 같은 계정 체계 사용 | 30의 계정 삭제, 20의 가입 차단을 Auth 설정으로 하면 읽생기에도 적용됨. Web2 가입 제거는 화면에서만 한다 |
| 트리거 `auth.users.app_auth_user_profile` → `app_profiles` | 읽생기 가입자에게도 Web2 프로필 행이 생김 | 28에서 정리 시 읽생기 가입 흐름에 영향 없는지 확인 |
| `app_workspace_members`(및 Web2 표 몇 개) | 읽생기 `rtw-delete-account`가 "Web2 계정인지" 판정에 사용(원장 RTW-1·RTW-출시준비 비고, 함수 원본은 읽생기 저장소) | 28에서 이 표를 없애면 읽생기 탈퇴 판정이 바뀜. 28 전에 읽생기 쪽 판정 기준 변경 필요 |

### 1.11 제거 담당 작업별 정리

| 작업 | 대상(요약) | DB 변경 |
| --- | --- | --- |
| 20 | 가입 탭·초대 안내·FIRST ADMIN·접근요청 화면·`access-approval.js`·가입 fetch 가로채기, 관련 테스트, 비활성 구성원 관리 파일 | 없음(화면만) |
| 21 | Web2 할 일 화면·코드 전체, 다른 화면의 할 일 조회를 Google Tasks 연결로 교체 | 없음 |
| 22 | 참석자 코드·테스트, 참석자 자동 생성 트리거 | 트리거 삭제 1건(정지 지점) |
| 23 | 프로젝트 멤버·초대 코드, Edge 3개의 `app_space_members` 조회, 보관 프로젝트 서버 거부 | 없음(Edge 배포, 정지 지점) |
| 24 | 담당조직 3중 저장 → 하나로 | 있음 |
| 25 | `team-ai` → 개인 업무 AI(4절) | 있음 |
| 26~30 | 표·함수·트리거·정책 삭제, 역할 체계, 할 일 표, 보조 계정 | 있음 |
| 31 | 비활성 파일·CSS·smoke/fixture 참조 | 없음 |

## 2. DB-1 반복 오류

### 2.1 원장에 적힌 두 오류: 이미 멈춤

| 오류 | 발생 코드(사실) | 로그 | 원인·해결 |
| --- | --- | --- | --- |
| `column app_workspace_members.email does not exist` | `app/task-workflow.js` `twLoadContext`가 `select=workspace_id,user_id,role,email` 조회 | 9/21~9/24 하루 43~57회. 마지막 2026-09-24 16:51 KST | #250(2026-09-24 17:08 KST merge)에서 `email` 제거. 이후 로그 0건 |
| `permission denied for function app_project_publication_state` | `app/project-system-v3.js` `fetchDetail`이 프로젝트 상세를 열 때 RPC 호출. 함수 실행권한은 앞서 회수됨 | 9/21 65회, 9/22~23 14회. 마지막 2026-09-23 09:39 KST | #226(2026-09-23 19:28 KST)에서 호출 제거. 마지막 발생이 merge보다 이르다(그 사이 상세 화면 미사용으로 추정). 이후 0건 |

두 오류 모두 19의 협업 장치(구성원 이메일, 프로젝트 공개)에서 나왔다. 추가 조치 없음. DB-1은 "해결 확인"으로 닫을 수 있다.

### 2.2 새로 찾은 현재 진행형 오류

| 오류 | 원인(사실) | 영향 | 담당 |
| --- | --- | --- | --- |
| `null value in column "usage" of relation "app_ai_messages" violates not-null constraint` (REST 400, 2026-09-26 16:53 KST 확인) | `team-ai`가 사용자·AI 두 메시지를 한 번에 넣는데 사용자 메시지에만 `usage`가 없다. 여러 행 삽입은 빠진 칸을 NULL로 채워 NOT NULL 기본값이 적용되지 않는다. 오류를 확인하지 않아 화면에는 성공으로 보인다 | `app_ai_messages` 0행. 대화 이어가기 기록이 저장되지 않음. 보고서 초안 생성 자체는 됨 | 25(팀 AI 교체)에서 처리. 급하면 `team-ai` 1줄 수정 + Edge 배포 |

### 2.3 참고: 그 밖의 로그

- `DELETE /auth/v1/user/identities/<id>` 404가 9/25~26 11회(휴대폰 브라우저·안드로이드 앱·PC). 이 저장소 코드에는 호출이 없다. 읽생기 쪽 호출로 추정. 범위 밖(5절).
- `refresh_token` 400 4회: 만료 세션 갱신 실패. 정상 범주로 보임.
- 9/25의 다수 `permission denied`·`column does not exist`는 작업 세션의 검증 조회 시각과 일치(Task 12·13 검증).

## 3. TASK-설계 (Web2 할 일 → Google Tasks)

확정 조건: 원본은 Google Tasks 목록 1개. Web2는 할 일 ↔ 프로젝트·회의·담당조직 연결 정보만 보관.

### 3.1 연동 방식: 기존 구조 재사용 가능

- `supabase/functions/google-tasks`(v6, verify_jwt=false, 함수 코드에서 사용자 확인)가 이미 `status / lists / tasks / create / update / toggle / delete / start`를 제공한다. `app/google-tasks.js`가 할 일 탭에서 쓴다.
- Google 토큰은 일정과 같은 `app_google_calendar_connections` 한 행을 공유한다. 별도 연결 없음.
- 권한 범위: `google-tasks` `start`는 `calendar.events`, `calendar.calendarlist.readonly`, `tasks`를 `include_granted_scopes=true`, `prompt=consent`로 요청한다. `google-calendar` `start`는 일정 범위만 요청하지만 `include_granted_scopes=true`라 이미 받은 `tasks` 권한이 유지된다(Google 증분 인증 동작, 추정 아님이나 실계정 확인은 안 함).
- 재동의 영향: 새 권한 범위를 더하지 않으므로 추가 재동의는 없다. 소유자 연결에 `tasks` 권한이 없으면 `status`가 `needs_reconnect`를 돌려주고 화면이 "다시 연결"을 안내한다(기존 동작). 현재 소유자 토큰에 `tasks` 권한이 있는지는 DB로 알 수 없다(사용자 확인 항목).
- 앱 검증 영향: `tasks`는 `calendar.events`와 같은 민감(sensitive) 등급이며 이미 요청 중이다. 새 등급 추가가 아니므로 검증 상태가 달라지지 않는다. Google 설정 변경 없음.
- OAuth 복귀 주소가 Web1 함수 `public-policy-drive/callback`이다. `public-policy-drive`를 정리할 때 함께 옮겨야 한다(의존관계 기록).

### 3.2 목록 1개

- `tasks` 동작은 현재 모든 목록을 읽는다. "목록 1개"를 코드에서 고정해야 한다.
- 선택지: (A) Google 기본 목록(`@default`, 휴대폰 Google Tasks·Gmail·캘린더 옆 칸에 바로 보임) / (B) "웹2" 전용 목록을 새로 만듦. 권장 A. 사용자 결정 항목.

### 3.3 연결 정보 저장 구조 (DB 변경, 초안만)

원칙: 제목·마감일·완료 여부는 Google에만 둔다. Web2는 ID와 연결 대상만 저장한다.

```sql
-- 초안. 실행 금지. 4.4의 통합안을 택하면 이 표 대신 app_record_links를 만든다.
create table public.app_task_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  google_tasklist_id text not null,
  google_task_id text not null,
  project_id uuid references public.app_spaces(id) on delete cascade,
  meeting_id uuid references public.app_meetings(id) on delete cascade,
  organization_id uuid references public.app_suborganizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint app_task_links_one_target check (num_nonnulls(project_id, meeting_id, organization_id) = 1),
  unique (google_task_id, project_id, meeting_id, organization_id)
);
alter table public.app_task_links enable row level security;
create policy task_links_owner_all on public.app_task_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
```

- 대상별 FK 칸을 따로 둔 이유: 프로젝트·회의·조직이 지워질 때 연결도 DB가 함께 지운다(ON DELETE CASCADE). 대상 종류 문자열 + ID 한 칸 방식은 이 보장이 없다.
- Google에서 할 일이 지워지면 연결이 고아가 된다. 목록을 읽을 때 없는 ID의 연결을 지우는 정리를 `google-tasks`에 둔다(서버에서, 소유자 확인 후).
- 할 일을 다른 목록으로 옮기면 Google 할 일 ID가 바뀔 수 있다(추정). 목록 1개 고정이면 영향 작음.
- 목록 개수(#305 프로젝트 목록 합계)는 "연결 행 수 + Google 완료 여부"로 계산한다. Google 조회가 필요하므로 개수는 미완료 기준으로 바꾸는 것을 제안(TASK-구현 "목록 개수 기준 변경").

### 3.4 홈 입력칸 "할일 …" 연동

- 입력 규칙: 첫 단어가 `할일`·`할 일`이면 "Google 할 일로 보낼까요?" 제안 1줄을 띄우고, 확인하면 `google-tasks` `create`(제목 = 나머지 글자). 확인 전에는 아무것도 저장하지 않는다.
- 다른 입력은 4절 인박스 메모로 저장한다. "할일" 입력은 Google이 원본이므로 인박스에 원문을 따로 남기지 않는다.
- 프로젝트·조직 연결은 입력 시 강제하지 않는다. 주간 정리(4절)나 할 일 화면에서 나중에 연결한다.
- 홈 화면은 디자인 작업 소관이므로 TASK-구현에서는 기존 할 일 탭 입력칸에 같은 규칙을 먼저 넣고, 홈 신설 때 같은 함수를 재사용한다.

### 3.5 기존 할 일 데이터 삭제 순서와 복구 경로

1. TASK-구현: Google Tasks 기반 화면·연결 표 적용(연결 표 생성은 정지 지점).
2. 미완료 2건 처리: 사용자가 Google Tasks에 다시 입력할지 결정(비구성원 배정 1건 포함).
3. 21: `app_tasks`를 읽고 쓰는 화면 코드 제거(할 일 탭, 프로젝트 상세, 회의 후속, `team.js`).
4. 25·23: `team-ai`, `meeting-ai-draft`의 `app_tasks` 조회 제거 후 Edge 배포(정지 지점).
5. 29: DB에서 트리거 → 정책 → 표 순서로 삭제(정지 지점). 적용 SQL에 `schema_migrations` 기록 1행 포함.

복구 경로: 사용자 결정은 "보관 없이 삭제"다. 표 삭제는 rollback SQL로 구조만 되살릴 수 있고 행은 되살릴 수 없다. 행 복구가 가능한 경로는 Supabase 자동 백업(요금제에 따라 기간 다름)뿐이다. 공개 저장소에는 행 데이터를 넣을 수 없다. 이 차이를 사용자 결정 항목으로 올린다.

### 3.6 일정 인증-1(400→401)과 묶을지

- `google-calendar`, `google-tasks` 모두 로그인 실패를 포함한 모든 오류를 `catch`에서 400으로 돌려준다. 할 일 원본이 Google로 가면 두 함수의 인증 실패 응답이 같은 문제다.
- 권장: 묶음C에서 한 PR, Edge 2개 배포(각각 verify_jwt=false 유지, `--no-verify-jwt`). 원장의 묶음C 구성과 같다.

## 4. 업무 인박스 구조 조사 (구현 금지)

### 4.1 현재 연결 표·필드 (질문 1)

| 원본 | 프로젝트 | 담당조직 | 회의 | 자료 | 일정 |
| --- | --- | --- | --- | --- | --- |
| 프로젝트 `app_spaces` | `parent_id`(상하위) | `app_project_suborganizations`(0행) | — | — | — |
| 회의 `app_meetings` | `project_id`, `workstream_id` | 없음 | — | — | `event_id`(Web2 일정) |
| 자료 `app_documents` | `project_id`, `workstream_id` | 없음 | `meeting_id` | — | `event_id` |
| Web2 일정 `app_events`(0행) | `project_id` | `app_event_suborganizations`(0행) | — | — | — |
| 주요 일정 `app_project_milestones` | `project_id`, `child_project_id` | 없음 | — | — | `event_id`, **`google_calendar_id`·`google_event_id`**(Google 일정 연결 선례) |
| 진행상황 `app_project_progress_updates`(1행) | `project_id`(필수), `workstream_id` | 없음 | — | — | — |
| 조직 기록 `app_suborganization_updates`(3행) | 없음 | `organization_id`(필수) | — | — | — |
| 할 일 `app_tasks`(삭제 예정) | `project_id` | 없음 | `source_type='meeting'`+`source_id` | — | — |

담당조직은 프로젝트·일정과만 연결 표가 있고(둘 다 0행), 회의·자료와는 연결이 없다.

### 4.2 메모 1건을 여러 대상에 연결 (질문 2)

- 기존 연결 표는 모두 "두 종류 사이 1쌍"(프로젝트↔조직, 일정↔조직)이다. 메모 1건 ↔ 여러 종류 대상을 담을 표는 없다.
- 기존 표 재사용은 불가. 연결 표 1개가 새로 필요하다.

### 4.3 인박스 새 표 필요 여부 (질문 3)

- `app_suborganization_updates`(18 담당조직 메모함)를 넓히는 안은 권장하지 않는다.
  - `organization_id`가 필수이고 권한 정책이 조직 기준(`app_is_owner_organization(organization_id)`)이다. 조직 없는 메모를 넣으려면 필수 해제와 정책 교체가 필요하고, 조직 화면의 "기록" 의미도 바뀐다.
- 권장: 새 표 `app_notes`(원문 메모) 1개. 18의 조직 기록은 그대로 두고, 이후 조직 화면 직접 입력도 `app_notes` + 조직 연결(확정)로 쓰게 바꾸면 한곳으로 모인다. 기존 3행 이전은 그때 결정.

### 4.4 원문 1회 저장·여러 곳 참조 (질문 4) — 최소 구조 초안

```sql
-- 초안. 실행 금지.
create table public.app_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  raw_text text not null check (length(raw_text) between 1 and 20000),
  occurred_at timestamptz not null default now(),   -- 메모한 날(주간 묶음 기준)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_record_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  -- 출처: 메모 1건 또는 Google 할 일 1건
  note_id uuid references public.app_notes(id) on delete cascade,
  google_task_id text,
  -- 대상: 정확히 하나
  project_id uuid references public.app_spaces(id) on delete cascade,
  organization_id uuid references public.app_suborganizations(id) on delete cascade,
  meeting_id uuid references public.app_meetings(id) on delete cascade,
  google_event_id text,                                -- 일정 연결(Google이 원본)
  report_kind text check (report_kind in ('business','organization')),  -- 사업보고/조직보고 분류
  status text not null default 'confirmed' check (status in ('suggested','confirmed')),
  created_at timestamptz not null default now(),
  constraint app_record_links_one_source check (num_nonnulls(note_id, google_task_id) = 1),
  constraint app_record_links_one_target check (num_nonnulls(project_id, organization_id, meeting_id, google_event_id) = 1)
);
-- RLS: 두 표 모두 private.app_is_workspace_owner(workspace_id) 하나로.
```

- 원문은 `app_notes`에 1번만 저장하고, 보고서·프로젝트·조직 화면은 `app_record_links`로 참조한다(복제 저장 없음).
- `app_record_links`는 3절의 할 일 연결도 겸한다(`google_task_id` 출처). 이 통합안을 택하면 TASK-구현과 25의 DB 변경이 한 번으로 준다. 대신 TASK-구현 시점에 메모 표도 함께 만들게 된다. 사용자 결정 항목.

### 4.5 AI 분류 "제안 상태" 최소 구조 (질문 5)

- 연결 행의 `status` 한 칸(`suggested` / `confirmed`)이면 충분하다.
  - 주간 정리 버튼 → AI가 `suggested` 연결을 만든다 → 확인 화면에서 체크한 것만 `confirmed`로 바꾸고 나머지는 지운다.
  - 별도 "제안 표"를 두지 않는다. 메모 1건의 여러 제안이 곧 여러 행이다.
- 사업보고/조직보고 구분은 연결의 `report_kind`. 프로젝트 연결은 사업, 조직 연결은 조직이 기본값이라 입력칸을 늘리지 않는다.
- 기존 선례: `app_meetings.ai_draft`+`result_status`+`finalized_at`, `app_suborganization_weekly_reports.ai_draft`+`status(draft/final)`, `app_documents.auto_classified`+`classification_note`. 모두 "AI 초안 → 사용자 확정" 형태라 같은 사고방식으로 맞출 수 있다.

### 4.6 자동요약과 기존 진행기록 결합 (질문 6)

- 16의 진행상황 칸은 `app_project_progress_updates`(상태·요약·다음 할 일·기준일)다. 사용자가 직접 쓴 행이다.
- 자동요약도 같은 표에 쓰되 `metadata`로 구분하는 안이 최소 변경이다(새 칸 없음, `metadata`는 NOT NULL jsonb로 이미 있음).
  - AI 초안: `metadata = {"source":"ai","status":"draft","note_ids":[...]}`. 화면은 수동 기록 옆에 "새 초안"으로 보여주고, 선택하면 `status:"accepted"`로 바꾼다. 수동 기록은 절대 덮어쓰지 않는다.
  - 근거 이동: `note_ids`로 원문 메모를 연다. 정식 연결은 `app_record_links`가 원본이고 `note_ids`는 초안 생성 시점의 근거 목록이다.
- 조직 쪽은 `app_suborganizations.recent_month_summary`·`year_summary`(18에서 읽기 전용으로 접음)와 `app_suborganization_weekly_reports`(0행)가 있다. 조직 현황은 `app_suborganization_weekly_reports`를 같은 방식(draft/final)으로 재사용한다.

### 4.7 담당조직 업데이트와 인박스 관계 (질문 7)

- 현재 조직 기록(`app_suborganization_updates`)은 "조직이 정해진 메모"다. 인박스 메모 + 조직 확정 연결과 의미가 같다.
- 권장 순서: 25에서 인박스를 만들 때 조직 화면 입력칸도 `app_notes` + 확정 연결로 바꾸고, 기존 3행을 옮긴 뒤 `app_suborganization_updates` 쓰기를 멈춘다(표 삭제는 이후 DB 정리). 두 곳에 같은 메모가 생기지 않게 한 번에 바꾼다.

### 4.8 Google Tasks·Calendar가 원본일 때 Web2 보관 최소 범위 (질문 8)

- 할 일: `google_task_id`(+목록 1개 고정이면 목록 ID는 설정 1곳) + 연결 대상. 제목·마감·완료는 보관하지 않는다.
- 일정: `google_event_id`(+`google_calendar_id`) + 연결 대상. 선례 `app_project_milestones.google_*`.
- 보고서에 제목이 필요하면 생성 시점에 Google에서 읽는다. 확정된 보고서 본문에는 당시 제목이 텍스트로 들어간다(보고서는 산출물이므로 복제 금지 대상 아님).

### 4.9 주간보고 생성에 현재 데이터가 충분한가 (질문 9)

- 아니다. 현재 행 수: 조직 기록 3, 진행상황 1, 회의 6, 자료 22, Web2 일정 0, 할 일 58(삭제 예정). 주간 단위 원문이 거의 없다.
- 인박스가 생기고 몇 주 쓰여야 의미 있는 초안이 나온다. 일정은 Google 캘린더에서 주 단위로 읽을 수 있다(기존 `google-calendar` `events`).
- "이번 주 새 변화 / 계속 진행 중" 구분은 연결 행의 `created_at`(이번 주 새 연결)과 대상의 이전 연결 존재 여부로 계산할 수 있다. 새 칸 불필요.

### 4.10 25(팀 AI → 개인 업무 AI)를 이 구조의 AI 계층으로 (질문 10)

- `team-ai`를 새 이름의 함수로 바꾸거나 같은 이름에서 동작을 바꾼다. 필요한 동작 3개:
  1. `classify_week`: 기간 내 `app_notes` + 연결되지 않은 Google 할 일 → `suggested` 연결 행 생성(서버에서, 소유자 확인 후).
  2. `weekly_report`: `confirmed` 연결만 근거로 사업보고(프로젝트별)·조직보고(조직별)·일정(Google) 초안. 업무보고형(명사형 끝맺음, 표) 복붙용 출력 포함. 각 문장에 근거 메모 ID를 붙여 원문 이동.
  3. `project_summary`/`organization_summary`: 연결된 기록만 근거로 초안 → 4.6 방식으로 저장.
- 정리할 것: 구성원·역할 확인(`app_workspace_members` role) → 소유자 확인 하나로, "공공기관사업팀 공동 업무" 프롬프트 → 개인 업무, personal 범위의 `app_tasks`·`app_event_attendees` 조회 제거, 2.2의 메시지 저장 오류, 대화 기록 표(`app_ai_conversations/messages`)는 주간 정리에 필요 없으면 쓰지 않음.
- AI 제공자·모델: 현재 OpenAI, 모델명은 DB 설정. 바꿀지는 사용자 결정(사용자 결정 항목).
- 원칙 준수 장치: 근거는 연결된 기록만(서버가 연결 행으로 문맥을 모음), AI는 `suggested`만 만들고 `confirmed`는 사용자 요청으로만, 원문은 `app_notes`에만.

## 5. 범위 밖 발견사항 (고치지 않음)

1. `team-ai` 메시지 저장 실패(2.2). 25에서 처리 권장.
2. 비구성원 계정 1명의 Google 캘린더 연결 행(토큰)이 남아 있다. 30에서 계정 정리 시 함께.
3. 대기 중 접근요청 1건과, 소유자가 실행 가능한 승인 RPC가 남아 있다(1.2). 20에서 화면 경로 제거, 27에서 함수 삭제.
4. `app_workspace_members` 역할 트리거에 특정 계정 이메일이 고정되어 있다(DB에만 있음, 저장소에는 없음). 28.
5. 저장소에 없는 Edge Function이 배포되어 있다: `push-notifications`(v4, 저장소는 제거 migration만 있음), `auth-handoff`, `pc0914-checklist`, `pc-file-test`, `pc0914-storage-test`, `kptu-board-probe`, `rail-1007-*`, `joint-struggle-files`, `press-conference-files`, `rail-declaration-*`, `wedding-mc-shared`, 읽생기 함수들. Web2와 무관한 것도 섞여 있어 소유 확인이 필요하다.
6. `DELETE /auth/v1/user/identities/<id>` 404 반복(2.3). 이 저장소 코드에 없음. 읽생기 쪽 확인 필요(RTW).
7. `app/ARCHITECTURE.md`가 없는 파일 `notification-center-ui.js`와 "프로젝트 초대 수락" E2E를 설명한다. 문서 정리 필요(31 또는 20).
8. Google OAuth 복귀 주소가 Web1 함수 `public-policy-drive/callback`이다(3.1). Web1 정리 시 Web2 일정·할 일 연결이 끊기지 않게 주의.
