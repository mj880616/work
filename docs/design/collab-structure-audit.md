# Web2 협업 구조 읽기 전용 점검 보고서

- 점검일: 2026-10-27
- 기준: `main` `cbfc1c80d2747b7b2de8bf36d43e7c71c05c0b43` (clone 직후 HEAD)
- 성격: **읽기 전용 점검**. 코드·DB·Edge·Cloudflare·Auth 설정은 하나도 바꾸지 않았고, 운영 DB·Supabase는 조회하지 않았다. 이 문서 한 개만 추가한다.
- 전제: Web2는 명진 혼자 쓰는 앱이다(roadmap V30 결정). 협업 장치는 이미 대부분 화면에서 꺼졌고, 남은 것은 DB·Edge·테스트·CI 쪽 찌꺼기다.
- 근거의 한계: `supabase/migrations/`는 2026-09-16 이후 93개만 있고 초기(baseline) DDL이 없다. 그래서 표·정책·트리거의 **운영 전체 정의는 저장소에 없다**. 행 수는 2026-09-26 묶음A 조사([web2-bundle-a-investigation.md](../web2-bundle-a-investigation.md)) 시점 값이며 이번에 다시 확인하지 않았다. 삭제 전에는 운영 catalog 전량 조회(후속 22-DB·23-DB 문서의 4절 절차)가 필수다.

## 1. 원장 관련 행 (docs/roadmap.md)

| 행 | 제목 | 상태 | 이번 점검에서 본 현재 사실 |
| --- | --- | --- | --- |
| 2 | 캘린더 개인화 1차·협업 참석자 UI 정리 | 완료 | 앱 쪽 `app_event_attendees` 호출 0건(아래 표 6) |
| 19 | 단일사용자 전환 전 snapshot | 완료 #319 | 목록의 원본. 이번 점검은 그 목록을 현재 main과 대조한 것 |
| 20 | signup/invite/access/FIRST ADMIN UI 제거 | 완료 #325 | `app/`에 초대·접근요청·`app_invites` 호출 0건으로 확인 |
| 20-DB | 가입·초대·접근요청·역할 지정 DB 후속 | 대기 | 미착수(함수·표 그대로) |
| 22 / 23 | 참석자·프로젝트 멤버 활성 코드 제거 | 완료 #326 | 앱 호출 0건. 서버 쪽 잔여는 22-DB·Edge, 23-DB·Edge(대기) |
| 24 | 담당조직 canonical 구조 통합 | 대기 | 3중 저장이 지금도 살아 있고 화면이 실제로 쓴다(표 10) |
| 25 | 홈 AI 채팅창 필요성 판단 | 종료(취소) | Web2 안 AI 입력창 없음. 옛 AI 정리는 TASK-팀AI삭제 2단계 |
| 26 | collaboration DB/RPC/trigger 감사 | 대기 | **'26번 감사'로 불린 행.** 이 문서가 그 읽기 전용 1차분 |
| 27 | 확인된 collaboration DB/RPC/trigger 제거 | 대기 | 26 결과가 선행 |
| 28 | workspace_members/role 체계 제거 | 대기 | 아래 표 1: **제거 아님, 유지**를 권고 |
| 29 | 옛 Web2 할 일 행 삭제·이후 schema 정리 | 대기 | 행 삭제·쓰기 차단 완료, 표·정책·트리거·함수 정리 미착수 |
| 30 | 보조 Auth 계정 제거 | 대기 | 계정-1로 앞당김 처리 |
| 31-1 후속 / 31-2 | 남은 비활성 코드·문서·테스트 / dead API 정리 | 대기 | 표 9의 죽은 파일 4개가 여기 해당 |
| TASK-팀AI삭제 | 기존 팀 AI 전체 제거 | 대기 (1단계 #357 완료) | `team-ai` Edge가 아직 배포 대상 소스로 남음(표 7) |
| (CI) | Web2 membership removal E2E | 동작 중 | `.github/workflows/team-member-overview-e2e.yml`. 이름은 'team-member-overview'지만 실제로는 비구성원 접근·접근요청 푸시·단독 셸 3개 spec만 돈다 |

## 2. 점검표

표기: 크기 = 소(파일 1~3개) / 중(여러 파일+테스트) / 대(DB+Edge+테스트 동시). 추천 = 지움 / 남김 / 단순화. **보안 경계**는 지우지 않는 것이 기본이다.

| # | 항목 | 어디 있나 | 지금 쓰이나 (근거) | 지우면 영향 (RLS·다른 기능) | 추천 | 크기 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **workspace 구성원 표 `app_workspace_members`와 `app_workspaces`**, `private.app_is_workspace_owner()` / `app_is_workspace_admin()` | DB 표·함수(`20260925084844_task12a_sole_owner_db.sql`). 앱 12개 파일, Edge 14개 파일이 조회 | **쓰임(핵심).** 앱 부팅(`loader-v2.js:113`, `team.js:82`)이 이 표로 workspace를 정함. Edge 대부분이 `role==='owner'`를 이 표로 확인. owner 정책 `task12a_owner_all`이 거의 모든 표에서 `app_is_workspace_owner`를 부름. migration 45개 중 43개가 이 함수/표를 참조 | 지우면 **모든 RLS가 깨져 앱 전체 접근 불가 또는 열림.** 읽생기 탈퇴 판정(`rtw-delete-account`)도 이 표 사용(조사 1.10) | **남김 (보안 경계).** 행은 owner 1명이어도 됨. 역할 열을 없애는 등의 '단순화'도 RLS 전체를 다시 쓰는 일이라 지금은 하지 않음 | 대 |
| 2 | 가입·초대·접근요청 **화면** | 이전 `index.html`의 `#authView`, `#bootstrapView`, `access-approval.js`, `team.js` 초대 수락 | **이미 없음.** #325에서 제거. `app/`에서 `app_invites`·`app_access_requests`·`app_accept_invite` 호출 0건. 비구성원은 `accessDeniedView`(접근 거부 + 로그아웃)만 봄(`team.js:82`) | 해당 없음 | 지움(완료). 방어선인 `accessDeniedView`는 **남김** | - |
| 3 | 초대·접근요청·그룹 **표** `app_invites`, `app_access_requests`, `app_bootstrap_tokens`, `app_groups`, `app_group_members` | DB(baseline 정의, `task12a_owner_all` 정책이 `app_invites`에 붙음) | 앱·Edge 호출 0건. 2026-09-26 행 수: 초대 0, 접근요청 2, 부트스트랩 토큰 1, 그룹 0 | 정책·FK(`access_requests.invite_id→invites`)만 영향. `app_groups` 읽기 정책이 `app_is_workspace_member`를 부르므로 표를 지우면 그 호출 한 곳 소멸 | **지움.** 단 접근요청 2행·토큰 1행은 삭제 전에 비공개 백업(행 수·시각만 기록) | 중 |
| 4 | 초대·역할 지정 **함수** `app_create_invite`, `app_set_workspace_member_role`, `app_approve_access_request`, `app_reject_access_request`, `app_accept_invite`, `app_claim_owner`, `app_request_workspace_access`, `app_join_default_team` | DB 함수. 앞 두 개는 `20260925084844_task12a_sole_owner_db.sql`에서 owner 전용으로 재정의 | 앱·Edge 호출 0건. 일부는 authenticated 실행권한 회수됨. `app_create_invite`·`app_set_workspace_member_role`·승인/거절은 **owner가 호출하면 지금도 실행 가능**(구성원이 늘 수 있음) | 호출자 0이므로 앱 영향 없음. 권한을 복원하는 방식으로 되돌리면 안 됨 | **지움** (표 3과 같은 DB 묶음). 삭제 전까지는 실행권한 유지 상태를 점검 대상으로 기록 | 중 |
| 5 | 구성원 **역할 자동 부여 트리거** `trg_app_enforce_workspace_member_role` (특정 이메일 고정) | DB 트리거(`app_workspace_members`). 정의는 저장소에 없음 | 활성(구성원 행이 바뀔 때마다). 조사 1.2 기준 | 지우면 owner 자동 부여가 사라짐. 표 1의 행이 이미 있으면 영향 없음. 반대로 남기면 코드에 이메일이 박힌 채 | **지움** — 단 정의 원문을 운영에서 받아 확인한 뒤. 개인정보(이메일)를 이 문서에 쓰지 않음 | 소 |
| 6 | **일정 참석자** `app_event_attendees` + 자동 생성 트리거 `trg_app_add_event_creator_attendee` | DB. Edge `team-ai`(personal 문맥 조회) | 앱 호출 0건, 화면 없음. 트리거는 일정 저장마다 행을 만듦(Web2 일정 표 `app_events`는 Google 캘린더 단일화로 0건). Edge는 `team-ai` 1곳뿐 | owner 정책 `task12a_owner_all`만 소멸. `team-ai`가 아직 조회하므로 Edge가 먼저 정리돼야 함. 회의의 `attendee_count`(인원 수 숫자)는 **별개라 유지** | **지움** (Edge → 트리거/함수 → 표 순서). 데이터는 먼저 백업 | 중 |
| 7 | **옛 AI Edge** `team-ai`, `event-media`, `push-notifications`, `page-ai-draft`, `document-ai-index` | `supabase/functions/` 5개 | `team-ai`: 앱 호출 0건(`tests/security/team-ai-app-removed.test.mjs`가 보장). `event-media`: 포토룸 화면 삭제됨, 호출 0건. `push-notifications`: 이미 410 응답만 하는 12줄 껍데기. `page-ai-draft`·`document-ai-index`: 저장소 안 호출자 0건(`document-ai-index`가 쓰던 표 칸은 `ai-assist`가 이어 씀) | `team-ai`·`page-ai-draft`는 `OPENAI_API_KEY`·`app_ai_workspace_settings`를 쓰므로 **비밀값은 다른 Edge가 계속 써서 삭제 불가**. `team-ai` 지우면 표 6의 참석자 의존과 `app_ai_conversations`/`messages` 소비자가 사라짐 | **지움** (함수 undeploy는 승인형 workflow). `document-ai-index`는 호출자 없음 확인 후 | 중 |
| 8 | **회의 AI Edge** `meeting-ai-draft`, `meeting-ai-ingest` | `supabase/functions/`. 호출자는 앱의 `workflow-ai-v3.js`(표 9의 **죽은 파일**)와 테스트뿐 | 살아 있는 앱 경로에서 호출 0건. 다만 최근에도 배포·테스트가 계속 갱신됨(V38~V39). `app_space_members` 조회가 `meeting-ai-draft`에 남음 | 지우면 회의 AI 초안·수집 기능이 없어짐. 명진이 쓰는지 **결정 필요**(질문 2) | **명진 결정 후** 지움 또는 남김 | 중 |
| 9 | **죽은 앱 파일 4개** `task-layout.js`, `home-dashboard-v2.js`, `workflow-ai-v3.js`, `task-row-view.js` | `app/`. 어떤 로더·HTML·다른 JS도 부르지 않음(전체 grep 확인). 테스트·CI(`app-smoke-check.yml`, `task-visibility-observer-check.yml`, `scripts/check-app-smoke-contract.mjs`, 각종 spec/fixture)만 참조 | **안 쓰임.** `app_workspace_members`·`app_tasks`를 부르는 코드가 여기 들어 있음(`task-layout.js`, `home-dashboard-v2.js`, `workflow-ai-v3.js`) | 파일 삭제 시 위 테스트·fixture·CI 목록을 같은 PR에서 정리해야 CI가 통과. 기능 영향 없음(화면 경로 이미 없음) | **지움** (roadmap 31-1 후속 그대로) | 중 |
| 10 | **담당조직 3중 저장** `app_suborganization_assignees`(13), `app_profile_workplaces`(12), `app_suborganizations.default_assignee_name` + 동기화 트리거 3개 | DB + `suborganizations.js`, `workplace-detail.js`, `profile-settings.js`, 외 15개 파일이 `app_suborganization_assignees`를 읽음 | **쓰임(활성).** '내 담당 조직' 필터·홈·바구니·Drive 요약이 이 표를 읽음. `suborganizations.js`의 담당자 지정 모달(`openAssign`→`ensureMembers`)은 구성원 표를 읽어 '담당자 후보'를 보여 줌 — 1인 앱에선 후보가 owner 1명뿐 | 표를 하나로 합치면 15개 화면·72개 테스트 참조가 바뀜. 동기화 트리거를 지우려면 canonical을 먼저 정해야 함. `private.app_can_edit_suborganization`이 이 표를 보면 **RLS 경계** | **단순화** — 담당자 지정 모달(구성원 목록 의존)부터 화면에서 제거, 표 통합은 24에서 별도. 서둘러 지우지 않음 | 대 |
| 11 | **프로젝트 구성원·초대** `app_space_members`, `app_project_invitations`, `app_respond_project_invitation` | DB. Edge `meeting-files`(`canEditProject`), `meeting-ai-draft`(`canEditMeeting`)에 조회 코드 잔존 | 앱 호출 0건. `meeting-files`의 `canEditProject`는 정의만 있고 호출되지 않음(파일 내 1회 등장). 정책 일부가 `app_can_manage_space`·`app_is_workspace_member` 호출 | Edge 두 곳의 helper를 먼저 지워야 표 삭제 가능. 초대 일관성 트리거만 사라지고 공용 `private.app_enforce_workspace_links()`는 다른 표가 쓰므로 **유지** | **지움** (Edge helper → RPC → 표). `private.app_can_view/edit/manage_space`는 이미 `owner_id=auth.uid()` 기준이므로 **남김**(이름만 옛 구조) | 대 |
| 12 | **역할 등급 helper** `app_is_workspace_member`, `app_role_rank`, `app_workspace_role`, `app_user_in_workspace`, `app_spaces_create` 정책의 `role_rank>=20` | DB 함수·정책 | 일부 정책이 부름(`app_spaces_create`, `app_internal_checklist_items`, `app_project_templates`, `app_groups`). 앱·Edge 직접 호출 0 | 이 함수를 쓰는 정책을 모두 바꾸기 전에 지우면 **그 표의 접근이 깨짐** | **남김** → 표 3·11 정리로 호출자가 0이 되면 마지막에 단순화. `app_spaces_create`는 owner 확인으로 교체 후보(보조 관리자 계정이 지워지면 실질 위험은 낮음) | 중 |
| 13 | 옛 **할 일 표** `app_tasks` (+ `assignee_id` 열, 트리거 3개, 정책 `task12a_owner_all`) | DB. 살아 있는 앱 코드는 없음(죽은 파일 3개와 `team-ai`만 조회) | 행 삭제·쓰기 차단 완료(#359~#361). 표는 `authenticated` SELECT만 남음. 할 일 원본은 Google Tasks | 들어오는 FK 없음. 표 삭제 전 `team-ai`(표 7)와 죽은 파일(표 9)이 먼저 사라져야 함 | **지움** (roadmap 29의 '이후 schema 정리'). 스키마만 — 데이터는 이미 0건 | 중 |
| 14 | 옛 **팀 AI 데이터 표** `app_ai_conversations`(4), `app_ai_messages`(0), `app_ai_workspace_settings`(1), `app_ai_daily_usage`(6) | DB. 소비자: `team-ai`(대화·메시지), **모든 AI Edge**(`app_ai_workspace_settings`=모델 설정, `app_ai_daily_usage`=하루 사용량) | `app_ai_conversations`/`messages`는 `team-ai`만 씀. `app_ai_workspace_settings`는 7개 Edge, `app_ai_daily_usage`는 4개 Edge(`ai-assist` 포함)가 **지금도 사용** | 설정·사용량 표를 지우면 `ai-assist`(활성 AI)까지 멈춤 | 대화·메시지 표: **지움**(`team-ai` 제거 뒤). 설정·사용량 표: **남김**(이름만 workspace 기준, 단순화는 후속) | 중 |
| 15 | 쪽지 `app_direct_messages` (5행) | DB. 앱·Edge 호출 0건, 푸시 트리거는 9/25에 삭제됨 | 화면 없음. 소유자와 이제 없는 계정 사이 기록 | owner 정책만 소멸 | **지움** — 5행 내용은 명진이 한 번 확인 후 백업(질문 3) | 소 |
| 16 | 일정 부속 `app_event_comments`, `app_event_photos`, Storage `team-event-media`, Edge `event-media` | DB·Storage·Edge | 포토룸 화면 삭제(#348). 앱 호출 0건. Web2 일정 표 자체가 Google 캘린더로 단일화 | `app_events.body`·`app_update_event_body`·`app_documents.event_id`는 다른 사용처 확인 필요(roadmap 포토룸삭제 2단계) | **지움** — CAL-웹2일정삭제와 같은 묶음에서. **사진 데이터는 요청 없으면 보존**하는 원칙에 따라 Storage는 마지막 | 중 |
| 17 | 공유 범위 **문서 가시성** `app_documents.visibility` (`workspace`/`private`/`groups`), `harden_document_visibility_read_paths` | DB 열·읽기 함수(`20260916064219_...`). 앱은 저장 시 `visibility:'private'` 고정(`team.js:223`) | 'workspace'·'groups' 값을 쓰는 화면 없음. 읽기 권한 함수가 이 값을 봄 | 이 함수는 AI 보조 표의 **우회 차단 장치**(주석)라 건드리면 읽기 경계가 바뀜 | **남김 (보안 경계).** 값 확장만 막고 정리는 하지 않음 | 소 |
| 18 | 공유 링크 `share_pages`(공유 페이지), Edge `share-page-read`/`share-page-media` | 앱 `share-pages*.js`, `share/`, 마이그레이션 5개 | **쓰임(활성).** 협업이 아니라 명진이 바깥에 보여 주는 '읽기 링크'. 최근에도 기능 추가 중 | - | **남김** (협업 구조 아님) | - |
| 19 | 옛 공개/토큰 공유 RPC `app_open_share`, `app_public_projects_snapshot` | DB 함수. 호출: Web1 `public-page-edit` Edge가 `app_save_page_v2`/`app_can_edit_page_rpc`를 씀 | `app_open_share`·`app_public_projects_snapshot`: 앱·Edge 호출 0건. snapshot 함수는 실행권한이 postgres만 | Web1 공개 페이지 경로와 얽혀 있음(`app_save_page_v2` 등은 **Web1 사용 중 → 남김**) | `app_open_share`·`app_public_projects_snapshot`: **지움**(Web1 호출 0 재확인 후). `app_save_page_v2` 계열: **남김** | 소 |
| 20 | 비구성원 방어 `accessDeniedView`, 테스트 `nonmember-access.spec.mjs`, `solo-shell.spec.mjs`, `access-request-push.spec.mjs` | 앱 `team.js`, CI `team-member-overview-e2e.yml` | **쓰임.** 이 화면이 '내 계정이 아닌 사람이 로그인했을 때'의 마지막 안내 | 지우면 비구성원이 빈 화면을 봄. RLS가 막아 주긴 하나 안내가 없어짐 | **남김.** `access-request-push.spec.mjs`는 접근요청이 없어진 뒤에는 **지움** | 소 |
| 21 | 그 밖의 Web1·실험용 Edge `pc0914-checklist`, `pc0914-storage-test`, `pc0921-board`, `pc-file-test`, `kptu-board-probe`, `rail-1007-page(-v2)`, `wedding-mc-shared` | `supabase/functions/` | Web2 앱 호출 0. Web1/실험용이라 **이번 협업 구조 점검 범위 밖** | - | **이번엔 손대지 않음.** 별도 Web1 점검에서 | - |

## 3. 상위 발견 10개

1. **RLS 뿌리는 `app_workspace_members`(owner 1행)다.** 새 migration 45개 중 43개가 `app_is_workspace_owner`/구성원 표를 부르고 앱·Edge가 부팅·권한 확인에 쓴다. 28번('workspace_members/role 체계 제거')은 **지우는 작업이 아니라 유지**로 바꿔야 한다.
2. **화면 쪽 협업 구조는 사실상 정리 끝.** 가입·초대·접근요청·참석자·멤버 UI는 `app/` 호출 0건. 이번에 지울 것은 DB·Edge·테스트다.
3. **owner가 지금도 호출 가능한 초대/역할 함수가 있다.** `app_create_invite`, `app_set_workspace_member_role`, 접근요청 승인·거절. 화면이 없어 안전하지만, 구성원이 늘어날 수 있는 입구라 가장 먼저 지울 DB 후보다.
4. **죽은 앱 파일 4개가 옛 구조를 붙들고 있다.** `task-layout.js`·`home-dashboard-v2.js`·`workflow-ai-v3.js`·`task-row-view.js`는 어디서도 로드되지 않지만 CI·smoke·fixture가 참조해 지우기 어렵다. 같은 PR에서 테스트까지 정리하면 `app_tasks`·구성원 조회가 앱에서 사라진다.
5. **옛 AI Edge 5개가 호출자 없이 배포 대상으로 남음.** `team-ai`·`event-media`·`push-notifications`(410 껍데기)·`page-ai-draft`·`document-ai-index`. `OPENAI_API_KEY`와 `app_ai_workspace_settings`·`app_ai_daily_usage`는 활성 AI(`ai-assist` 등)가 쓰므로 **남겨야 한다**.
6. **회의 AI 두 개(`meeting-ai-draft`·`meeting-ai-ingest`)의 호출자는 죽은 앱 파일뿐.** 그런데 최근까지 배포·테스트가 갱신됐다. 명진이 쓰는 기능인지 먼저 정해야 한다.
7. **담당조직 3중 저장(24번)은 아직 살아 있고 화면이 실제로 읽는다.** 15개 파일·72개 테스트 참조. 담당자 지정 모달은 구성원 목록에 기대지만 1인 앱에선 의미가 없다. 모달부터 화면에서 빼고 표 통합은 천천히 한다.
8. **`app_documents.visibility` 읽기 함수는 우회 차단 장치다.** 'workspace'·'groups' 값은 안 쓰이지만 AI 보조 표 읽기 경계라 단순화 대신 **남기는 것이 안전**하다.
9. **저장소만으로는 삭제 목록을 확정할 수 없다.** baseline DDL이 없어 정책명·트리거 원문·FK 전체가 빠져 있다. 지우기 전 운영 catalog 전량 조회와 백업이 필수다(이번에는 하지 않음).
10. **CI 이름이 실제와 다르다.** 'Web2 membership removal E2E'(`team-member-overview-e2e.yml`)는 비구성원 접근·단독 셸 3개만 돌린다. `collaboration-ownership-check.yml`은 이름과 달리 '알림·푸시 제거' 검사다. 정리 때 이름을 실제 내용에 맞추면 헷갈림이 줄어든다.

## 4. 정리 순서 제안 (화면 → Edge → DB, 데이터는 보존)

각 단계는 별도 PR. DB·Edge 배포는 승인형 workflow이며 적용 직전에 멈춘다. **어떤 단계에서도 데이터를 삭제하지 않고 먼저 비공개 백업(행 수·시각·해시만 기록)** 한다.

1. **화면·앱 코드 (DB 변경 없음)**
   - 1-1. 죽은 파일 4개(표 9) 삭제 + 이를 참조하는 spec·fixture·CI·smoke 계약 정리를 한 PR로.
   - 1-2. 담당자 지정 모달(`suborganizations.js` `openAssign`/`ensureMembers`)과 구성원 목록 조회 제거(표 10 일부).
   - 1-3. `access-request-push.spec.mjs` 등 사라진 기능 테스트 정리, 워크플로 이름 정정(발견 10).
2. **Edge**
   - 2-1. `meeting-files`·`meeting-ai-draft`의 `app_space_members` 조회 helper 제거(표 11) — 재배포 필요.
   - 2-2. 질문 2의 답에 따라 `meeting-ai-*` 정리. `team-ai`·`event-media`·`push-notifications`·`page-ai-draft`·`document-ai-index` undeploy(표 7).
   - `OPENAI_API_KEY`는 삭제하지 않는다.
3. **DB (각각 snapshot·rollback·사후 확인 SQL 먼저, 별도 승인)**
   - 3-1. 초대·역할 지정 함수(표 4) 삭제와 owner에게 열려 있는 입구 닫기. 가장 위험이 적고 효과가 큼.
   - 3-2. 참석자 트리거·함수 → `app_event_attendees`(표 6), 프로젝트 구성원·초대 → `app_space_members`·`app_project_invitations`·RPC(표 11).
   - 3-3. 빈 표들: `app_invites`·`app_access_requests`·`app_bootstrap_tokens`·`app_groups`·`app_group_members`(표 3), `app_ai_conversations`/`messages`(표 14), `app_direct_messages`(표 15), `app_tasks`(표 13).
   - 3-4. 일정 부속(표 16)은 CAL-웹2일정삭제와 묶어 마지막에. Storage 사진은 보존 원칙대로 마지막.
   - 3-5. 정책 호출자가 0이 된 뒤에만 역할 등급 helper(표 12) 정리.
4. **하지 않는 것**: `app_workspace_members`·`app_workspaces`·`app_is_workspace_owner`·`private.app_can_*_space`·`app_documents.visibility` 읽기 함수·`share_pages`는 지우지 않는다. Auth 계정 삭제·Auth 가입 설정은 읽생기와 공유라 건드리지 않는다.

## 5. 명진 결정 질문 (일상어, 추천 포함)

1. **'로그인 문지기' 표는 남겨도 되나요?** 지금 앱은 '이 계정이 명진인지'를 작은 표 한 줄로 확인합니다. 이걸 없애면 모든 데이터 보호가 같이 풀립니다. → **추천: 남깁니다.** (원장 28번은 '제거'에서 '유지'로 바꿉니다.)
2. **회의 AI 초안·수집 기능을 쓰시나요?** 지금 앱 화면에서 부르는 곳은 이미 없어졌는데 서버에는 남아 있습니다. → **추천: 쓰지 않으면 지웁니다.** 쓰고 계시다면 어느 화면에서 쓰는지 알려 주세요(그럼 남기고 연결을 확인합니다).
3. **옛 쪽지 5건과 접근요청 2건은 지워도 되나요?** 지우기 전에 비공개로 한 번 백업합니다. → **추천: 백업 후 삭제.** 내용을 보고 싶으면 말씀해 주세요(공개 저장소에는 올리지 않습니다).
4. **담당자 지정 화면(조직마다 담당자를 고르는 창)을 없애도 되나요?** 혼자라 고를 사람이 없습니다. → **추천: 없앱니다.** 조직 목록 전체를 '내 조직'으로 보는 정리(24번)는 그 다음에 시안을 보고 정합니다.
5. **'알림 제거 검사' 같은 이름이 헷갈리는 검사 이름을 바꿔도 되나요?** 동작은 그대로, 이름만 실제 내용에 맞춥니다. → **추천: 바꿉니다.**
6. **정리는 위 순서대로 화면 → 서버 함수 → 데이터베이스 순으로, 각 단계마다 따로 보고해도 되나요?** DB 단계는 직전에 멈추고 승인 버튼만 누르시면 됩니다. → **추천: 그렇게 진행.**

## 6. 이번 점검에서 하지 않은 것

- 운영 DB·Supabase·Edge 배포본 조회(행 수, 정책, 트리거 원문, 배포 버전 대조)
- 코드·SQL·테스트 수정, 파일 삭제
- 읽생기 저장소 확인(탈퇴 판정 기준)
- Auth 계정·설정 확인
