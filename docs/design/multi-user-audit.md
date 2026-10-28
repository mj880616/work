# MULTI-노조사용자 단계 ① 사람별 분리 전수 점검 + 명진 전용 잠금 (조사·설계)

- 원장 행: MULTI-노조사용자 (맨 뒤 순서). 요청 원문: Drive 'Web2 요청함' 10/29 01:02 항목, [10/29 01:07~01:15 사용자 결정].
- 기준: `main` `78bca261f` (2026-10-29). 저장소만 읽었고 production 조회는 하지 않았다(웹 세션, AGENTS.md 1절).
- 이 문서는 조사·설계만 한다. 코드·DB·Edge·규칙 문서(AGENTS.md)는 바꾸지 않는다.
- 공개 저장소이므로 고정 값(작업공간 이름, 폴더 ID, uuid, 주소, 메일)은 적지 않고 파일:줄과 값의 종류만 적는다.

## 0. 한눈 요약

| 구분 | 지금 상태 | 여러 사람으로 열 때 |
| --- | --- | --- |
| DB 표 61개(저장소에서 만든 것) | 54개가 `private.app_is_workspace_owner(workspace_id)`로 '내 작업공간'만 허용. 7개는 서비스 키 전용·권한 없음 | **사람마다 작업공간 1개**를 주면 대부분 그대로 분리됨 |
| DB 기본 표 약 45개 | 정의·일부 정책이 저장소에 없음(운영에만 있음) | **운영 catalog 전량 조회가 먼저 필요** |
| 작업공간 만들기 | 만드는 경로가 저장소에 없음(가입 트리거·생성 RPC 0건) | 가입 때 작업공간을 만드는 서버 함수가 새로 필요(단계 ②) |
| Google Drive | 프로젝트 전체에 연결 1개(`public_policy_drive_config` id=1). 10여 개 Edge가 같이 씀 | **다른 사람 파일이 명진 Drive로 감. 바구니 폴더는 섞임** → 사람별 Drive 연결로 구조 변경(단계 ②) |
| 캘린더·할 일 연결 | 이미 사람별(`app_google_calendar_connections.user_id`) | 그대로 사용 가능 |
| 통화·텔레그램 수집 | `collector-feed`가 고정 작업공간 이름으로 씀, 비밀값 하나=명진 수집기 하나 | 구조상 이미 명진 전용. **읽는 쪽(화면·RPC·ai-assist)은 작업공간 owner면 누구나 열림** → 서버 잠금 필요(3절) |
| 고정 작업공간 이름 | 화면 4곳·Edge 5곳 | 명진 전용 기능 판정을 이 이름 대신 '기능 허용 표'로 바꿔야 함 |
| RTW(읽생기) | Auth 공유. rtw 표는 베타 허용 목록으로 이미 막힘 | 가입만으로 읽생기 자료가 열리지는 않음. 탈퇴 함수 판정만 확인 필요(4절) |

## 1. 지금 구조와 충돌하는 규칙 목록

### 1.1 충돌하는 자리

| 위치 | 지금 규칙 | 이 요청과 부딪치는 점 |
| --- | --- | --- |
| AGENTS.md 5절 첫 문단(113줄) | Web2는 로그인한 **단 한 명의 소유자**만 쓰는 개인 업무 시스템(sole-owner). 공유 팀 DB·다중 사용자 협업 제품이 아님 | 노조 사람 3~10명이 **각자** 쓰게 됨. '서로 공유'는 하지 않으므로 '협업 제품이 아님'은 유지되지만 '단 한 명'은 바뀜 |
| AGENTS.md 5절 owner-only(116줄) | 데이터 접근은 DB·Edge에서 owner만 | 그대로 유지 가능. 뜻을 '각 작업공간의 owner만(사람마다 작업공간 1개)'으로 명확히 해야 함 |
| AGENTS.md 5절 익명 차단(115줄) | 비로그인은 로더가 로그인으로 보냄 | 유지. 다만 '로그인했지만 작업공간 없음'(지금은 접근 거부 화면)이 '가입 → 작업공간 자동 생성'으로 바뀜 |
| AGENTS.md 5절 협업 구조(121줄) | 작업공간 구성원·역할·초대·참석자·배정은 Task 19~31에서 제거 예정, 새 기능을 얹지 않음 | **충돌 없음**. 각자 따로 쓰는 구조라 협업 표는 계속 필요 없음. 단, 소유자 판정의 뿌리인 `app_workspace_members`(role='owner' 행)는 제거 대상에서 빼고 '사람↔작업공간 연결표'로 남겨야 함 |
| AGENTS.md 5절 RTW(120줄) | RTW는 같은 Supabase·Auth를 쓰는 별개 제품, rtw_* 건드리지 않음 | 가입 허용 방식이 Auth 공유라 RTW에도 영향(4절). rtw_* 수정은 계속 금지 |
| `private.app_is_workspace_owner` (`20260925084844_task12a_sole_owner_db.sql:5-19`) | 작업공간 구성원 표에 (그 작업공간, 나, owner) 행이 있으면 참 | 함수 자체는 사람마다 작업공간 1개면 그대로 맞음. '명진만' 판정은 이 함수로 못 함 → 새 판정 함수 필요(3절) |
| Task 12a 정책 `task12a_owner_all`(`app_workspaces`·`app_workspace_members`, 같은 파일 198-203) | 이미 owner인 사람만 작업공간·구성원 행을 씀 | 새 사람은 스스로 작업공간을 못 만듦. 가입 때 서버(DEFINER 함수)가 만들어 줘야 함 |
| 운영 전용 트리거 `trg_app_enforce_workspace_member_role`(문서 `docs/web2-account1-env6-investigation.md:55`) | 고정 메일로 역할을 정함 | 새 사람 owner 행과 부딪칠 수 있음. 운영 정의 확인 후 정리(단계 ②) |
| `docs/web2-bundle-a-investigation.md:137-143` | Auth 가입을 막지 않은 이유=RTW와 설정 공유 | 유지. Web2 쪽에서 '가입 허용 여부'를 서버 함수로 판정 |
| 사용자 원칙 '정보 원본: 자료 원문=Drive' | 명진 Drive | 각자 자기 Drive가 원본(요청 5번). 원칙 문장은 '각 사용자 Drive'로 |

### 1.2 규칙 문서를 바꿀 자리 (단계 ② 시작 PR에서, 아직 고치지 않음)

- AGENTS.md 5절 첫 문단, 116줄(owner-only), 121줄(협업 구조) 세 곳. 다른 문서에 복사하지 않는다(AGENTS.md 머리말).
- `app/ARCHITECTURE.md`의 시작 순서 설명(세션 확인 → 구성원 행 → 접근 거부)에 '작업공간 자동 생성' 경로 추가.
- `docs/design/collab-structure-audit.md`·`docs/roadmap.md` Task 19~31 행: `app_workspace_members`를 제거 목록에서 빼는 설명(원장은 커맨드센터가 고침).

### 1.3 명진 결정 문장 초안

> 2026-10-29 사용자 결정(MULTI-노조사용자): Web2는 노조 사람(많아야 10명)이 **각자 자기 작업공간**에서 쓰는 개인 업무 시스템이다. 한 사람에 작업공간 하나, 작업공간 사이 공유·열람 화면은 만들지 않는다. 구글 계정이면 누구나 가입하고, 운영자(명진)는 이용 정지만 한다. 통화·텔레그램 기능은 운영자 작업공간에서만 서버가 허용한다. 협업 구조(구성원 역할·초대·참석자·배정)는 계속 제거 대상이며, 소유자 판정용 구성원 행(owner)만 남긴다.

AGENTS.md 5절 첫 문단 교체안(영문 유지):

> Web2 (`app/`) is a private personal work system. Each signed-in user owns exactly one workspace and sees only that workspace (one owner per workspace). It is not a shared team database or a collaboration product: there is no cross-workspace view. Operator-only features (calls, Telegram collection) are allowed only by a server-side feature check, never by UI hiding.

## 2. 전수 점검표

### 2.1 DB 표 (rtw_* 제외)

- 저장소 migration에는 `rtw_*` 정의가 0개(주석에만 등장)다. RTW 표는 읽생기 저장소가 원본이다.
- 기호: **WS**=`workspace_id` 칸 있음, **OWN**=`private.app_is_workspace_owner(workspace_id)`(또는 그 함수를 감싼 `app_is_owner_*`)로 막는 authenticated 정책.

#### (가) 저장소에서 만든 표 61개

| 표 | 작업공간 칸 | RLS가 '내 작업공간'으로 막나 | 단독 소유자 가정(파일:줄) | 비고 |
| --- | --- | --- | --- | --- |
| app_notes, app_note_folders | WS | OWN(+휴지통 숨김) | 없음 | |
| app_record_links, app_record_overlaps | WS | OWN(+같은 작업공간 검사) | 없음 | |
| app_share_pages, app_share_page_links, app_share_page_media | WS | OWN | 없음 | service_role이 일부 칸만 읽음(share-page-read) |
| app_todo_candidates, app_todo_radar_state | WS | OWN | 없음 | radar는 작업공간당 1행(정상) |
| app_ledger_imports·id_counters·topics·organizations·sources·records·record_sources·links·candidates·audit | WS | OWN(+되돌리기 전용 삭제) | 없음 | 번호표도 작업공간 기준 |
| app_ledger_auto_runs·auto_sources·fix_requests·record_changes | WS | OWN | 없음 | auto_sources는 통화를 재료로 씀 |
| app_task_attachments | WS | OWN | 없음 | 파일 자체는 명진 Drive(2.2) |
| app_library_folders·folder_items·tidy_backups·tidy_attempts·classify_attempts | WS | OWN | 없음 | |
| app_weekly_org_summaries, app_weekly_exec_requests | WS | OWN | 없음 | |
| app_reference_bundles, app_dispute_stages | WS | OWN | 없음 | |
| app_suborganization_dispute_stages | 조직 경유 | `app_is_owner_organization` | 없음 | created_by 칸 |
| app_calendar_work_refs, app_diary_stars | WS | OWN | 없음 | |
| app_journal_drafts, app_journal_next_week_sheets | WS | OWN | 없음 | |
| app_org_key_people, app_org_key_people_briefs | WS | OWN | 없음 | |
| app_ai_external_usage, app_ai_cost_entries | WS | OWN 읽기(+넣기) | 없음 | 상한 계산 재료(단계 ③) |
| **app_feed_items, app_feed_days** | WS | OWN 읽기·일부 고치기, service_role 넣기 | 수집기가 고정 작업공간에 씀(`20261024140000_call_tg_feed.sql:9`) | **통화·텔레그램** |
| **app_tg_personal_days, app_call_personal** | WS | OWN, service_role 넣기 | 위와 같음 | **텔레그램 / 통화** |
| **app_call_edits, app_call_edit_history** | WS | OWN 읽기(쓰기는 RPC) | 없음 | **통화** |
| **app_tg_senders, app_tg_day_senders** | WS | OWN 읽기(쓰기는 RPC) | 'owner 작업공간이 정확히 1개' 가정(`20261026190000_tg_sender_names.sql:205-210`) | **텔레그램** |
| **app_feed_folders, app_feed_rooms, app_feed_room_days, app_feed_summary_edits, app_feed_summary_edit_history** | WS | OWN 읽기 | 같은 가정(`20261027010000_tg_room_day_group.sql:121-126`) | **텔레그램** |
| app_onedrive_connections·folders·photos | WS | 정책 없음(authenticated 전면 거절, service_role만) | 작업공간당 연결 1개(정상) | 이미 작업공간별 |
| app_project_publications, app_project_public_blocks | project 경유 | 정책 없음·모든 권한 회수 | 폐기 구조 | 자료만 보존 |
| app_auth_handoff_consumptions | 없음 | 정책 없음(service_role만) | 없음 | 로그인 넘김 1회용 |

판정: 저장소에서 만든 표는 **사람마다 작업공간 1개**면 그대로 분리된다. 'owner 작업공간이 정확히 1개' 가정 2곳은 이 구조에서 맞으므로 그대로 둔다(한 사람에 작업공간 둘을 만들지 않는 규칙을 서버가 지키면 됨).

#### (나) 기본 표 (정의가 저장소에 없음, migration은 정책만 바꿈)

Task 12a(`20260925084844_task12a_sole_owner_db.sql:101-123`)가 32개 표의 정책을 `task12a_owner_all` 하나로 바꿨다.

| 표 | 작업공간 칸 | RLS | 단독 소유자 가정 | 비고 |
| --- | --- | --- | --- | --- |
| app_workspaces | id | OWN(id) | 고정 이름으로 찾는 곳 다수(2.4) | 만드는 경로 없음 |
| app_workspace_members | WS | OWN + 본인 행 읽기 | 운영 전용 트리거가 고정 메일로 역할 지정 | **소유자 판정의 뿌리**. owner는 남의 행도 넣을 수 있음 → 단계 ②에서 '본인 owner 행 1개'만 서버 함수로 |
| app_spaces(프로젝트) | WS | 읽기 `owner_id = auth.uid()`(`20260923074619:50-54`), 쓰기 정책 원문 없음 | 없음 | **판정 기준이 사람(owner_id)**. 나머지는 작업공간 기준 → 둘이 어긋나지 않는지 확인 |
| app_pages, app_events, app_meetings, app_suborganizations, app_org_affiliation_tags, app_ai_conversations·daily_usage·workspace_settings, app_direct_messages | WS | OWN | 없음 | |
| app_documents | WS | OWN + private만 허용 트리거 | 1회성 갱신이 고정 이름 사용(`20261024170000_library_reread_old_scans.sql:29,47,61`, 이미 적용) | |
| app_document_ai_index·chunks, app_event_attendees·comments·photos·suborganizations, app_ai_messages | 부모 경유 | `app_is_owner_*` | 없음 | attendees는 협업 잔재 |
| app_tasks | WS | OWN 읽기만(쓰기 회수) | 없음 | assignee_id 협업 잔재 |
| app_profiles 및 profile_report_projects·weekly_reports·workplaces·workplace_statuses | user 경유 | `app_is_owner_profile`(같은 작업공간 구성원 프로필) + 본인 읽기 | 사전 확인이 owner 프로필 존재 가정(`20261018112943_doc_categories_profile.sql:44-45`) | 사람마다 작업공간 1개면 '나만' |
| app_suborganization_* 6개 | 조직 경유 | `app_is_owner_organization` | 없음 | assignees는 협업 잔재 |
| app_invites, app_space_members, app_project_invitations, app_access_requests, app_groups, app_group_members | WS/부모 | OWN 또는 **원문 없음** | `app_access_requests` 기본 작업공간 고정(`20260925060000:110`) | **협업**. 제거 대상 유지 |
| app_project_progress_updates, app_project_workstreams·milestones·blocks·checkitems·sections, app_drive_settings, app_share_links | – | **원문 없음** | – | 운영 확인 필요(`docs/ed3-precheck-public-policy.md:62`) |
| 코드·문서에만 있는 표 14개(`app_google_calendar_connections`, `app_google_oauth_states`, `app_private_feature_access`, `app_project_drive_folders`, `app_meeting_drive_folders`, `app_drive_download_tokens`, `app_bootstrap_tokens` 등) | – | **원문 없음** | – | 운영 catalog 조회 필요 |

#### (다) 함수·RPC에서 볼 것

- 판정 함수: `app_is_workspace_owner`(위), `app_is_workspace_admin`=owner와 같음(task12a:205), `app_is_owner_document·event·organization·conversation·profile·workplace`(task12a:21-84), `app_can_view/edit/manage_space`=`app_spaces.owner_id = auth.uid()`(`20260923074619:7-47`).
- `limit 1`로 owner 작업공간을 고르는 협업 함수: `app_create_invite`(task12a:246-249), `app_set_workspace_member_role`(:366-369). 실행 권한 회수 기록이 저장소에 없다 → 여러 사람이 owner가 되면 **자기 작업공간에 남을 넣을 수 있음**. 단계 ①의 DB PR에서 실행 회수(3.4).
- service_role 전용이며 작업공간을 인자로 믿는 RPC 6개(collector-feed가 부름): `app_call_context_people`(`20261026160000:35`), `app_feed_room_touch`·`app_feed_room_day_add`(`20261027010000:135,181`), `app_feed_room_day_context`(`20261028030000:25`), `app_tg_senders_upsert`(`20261026190000:81`), `app_tg_sender_names_for_day`(`20261027030000:25`). anon·authenticated는 못 부르므로 지금은 안전. 3절 잠금 판정을 같이 건다.
- 통화·텔레그램 authenticated RPC 14개: `app_call_move`·`app_call_work_info`(`20261025200000:199,258`), `app_call_edit`(`20261026120000:71`), `app_feed_set_state`(`20261025210000:42`), `app_tg_sender_set_name·merge·forget`(`20261026190000:184,235,274`), `app_feed_room_set`·`room_day_set`·`folder_create·rename·delete`·`room_day_lines`(`20261027010000:267-440`), `app_feed_summary_edit`(`20261027200000:75`). 모두 OWN 판정만 함 → 3절 대상.

### 2.2 Edge 함수 (`docs/web2-env6b-edge-source.md` 5절 표 기준)

| 함수 | verify_jwt | 코드 인증 | 명진 고정 값(파일:줄, 종류) | 다른 사람이 부르면 | 통화·텔레그램 |
| --- | --- | --- | --- | --- | --- |
| ai-assist | true | `/user` 확인 후 **본인이 owner인 작업공간 정확히 1개**(`handler.ts:599-614`), 화면이 보낸 작업공간은 안 받음, 모든 DB 접근이 사용자 JWT(RLS) | AI 지침에 조직·사람 문구(`ledger-auto.ts:132-133`, `business-area.ts:184`, `call-refill.ts:84`, `hwp-convert.ts:43`, `library-fill.ts:221`, `schedule-titles.ts:95`) | 자기 것만. 가장 잘 분리됨. 월 상한은 작업공간별(`:750`) | **예**: `call_refill`(`:3109`), `ledger_auto`(통화 재료 `:1462,1494,1628`), `org_people_brief`(`:2681`) |
| collector-feed(배포 대기) | false | 비밀 헤더 하나, JWT 붙으면 거절 | 고정 작업공간 이름(`handler.ts:58,399`), 조직 이름(`context.ts:30`), AI 지침 사람 문구(`telegram.ts:42-47`) | 다른 사람 수집 경로 없음(명진 수집기 전용) | **예(전부)**: `call`·`call_skip`·`telegram`·`context` |
| drive-summary | false | cron 비밀 / 사용자 JWT+고정 작업공간 owner / 수집 비밀 | 고정 작업공간 이름(`core.mjs:11`, `ledger-export.mjs:81`), 조직 목록(`core.mjs:27-33`), 단일 Drive(`:325`), 'owner 1명' 가정(`:312-314`) | 다른 사람은 403 | **예**: `heartbeat`(통화 전사·텔레그램 수집 상태), `ai_usage`(수집기 AI 사용량) |
| public-policy-drive | false | `drive-start`는 고정 작업공간 owner/admin만(`index.ts:104-111`), callback은 state 해시 | 고정 작업공간 이름(`:104,238`), 단일 Drive 토큰 덮어쓰기(`:260`) | Drive 재연결은 명진만. 캘린더·할 일 토큰은 사람별 upsert(`:280-290`) | 아님 |
| basket-files | false | `getUser`, 본인 구성원 1행 owner 확인(`handler.ts:84-103`) | 단일 Drive(`_shared/drive-upload.ts:49`), 고정 폴더 이름(`:242,255,272`) | **위험**: 새 작업공간은 명진 Drive의 같은 이름 폴더를 찾아 **그대로 씀**(`drive-upload.ts:252-272`) → 첨부 섞임 | 아님 |
| document-actions | true | `/user`, 행의 작업공간 owner 확인(`:83`) | 단일 Drive(`:58`), 고정 백업 폴더(`_shared/hwp-edit.ts:41`) | 행 확인은 됨. 파일은 모두 명진 Drive, 백업 폴더 공용 | 아님 |
| document-ai-index | true | 사용자 토큰으로 접근 확인 후 service role | 단일 Drive(`:17`), AI 지침 조직 문구(`:25,28`) | 자기 것만(RLS) | 아님 |
| library-files | false | `getUser`, owner 확인 | 단일 Drive(`:25`), 고정 폴더 이름(`:28`), 출처 목록(`:61`) | 새 작업공간마다 명진 Drive에 같은 이름 폴더 생성 | 아님 |
| meeting-files | false | owner 확인 | 단일 Drive(`:10`), 고정 폴더 이름(`:13-14`) | 명진 Drive에 생성 | 아님 |
| meeting-ai-ingest | true | 사용자 JWT(RLS) | 단일 Drive(`:17`), AI 지침(`:23`) | 자기 것만, 파일은 명진 Drive | 아님 |
| meeting-ai-draft | true | 클라이언트 작업공간을 받되 owner 확인 | AI 지침(`:16`), 옛 admin/editor 분기(`:33-38`) | 자기 것만 | 아님(회의 녹취) |
| page-ai-draft | true | 클라이언트 작업공간 + owner 확인(`:37-42,66`) | AI 지침(`:27`) | 자기 것만 | 아님 |
| team-ai | false | 첫 구성원 행 하나(`index.ts:43`, `limit(1)`, **owner 확인 없음**) | AI 지침(`:47`) | 재료는 RLS가 막음. 옛 협업 표 읽음 | 아님 |
| workspace-drive | false | owner 확인, 일회용 토큰 | 단일 Drive(`:9`), 고정 폴더 이름(`:12`), 출처 목록(`:15`) | 파일은 명진 Drive | 아님 |
| event-media | false | `getUser`, 일정 owner 확인 | 없음 | 자기 것만(`list`는 전체를 읽고 거름, 범위 밖 10절) | 아님 |
| google-calendar, google-tasks | false | `getUser`, 연결을 `user_id`로 찾음 | OAuth 앱 값만 Drive 행에서 읽음(앱 단위, 문제 아님). 할 일 첨부는 단일 Drive(`task-files.ts:13`) | 자기 구글 계정만 | 아님 |
| onedrive-photos(배포 대기) | true | 본인 owner 확인(`handler.ts:1258-1267`) | 앱 단위 env만 | 작업공간별(정상) | 아님 |
| share-page-media | true | 사용자 JWT(RLS) | 없음 | 자기 것만 | 아님 |
| auth-handoff | false | Origin 허용 + `/user` | 허용 주소(사용자 값 아님) | 무관 | 아님 |
| public-page-edit, pc0921-board | false | **Web1**. 고정 관리자 uuid 비교(`public-page-edit/index.ts:11,47`, `pc0921-board/index.ts:20`) | 고정 uuid | 명진만 통과(의도) | 아님 |
| share-page-read, pc0914-checklist | false | **Web1** 공개 | 허용 주소 | Web1 공개 | 아님 |
| Web1 소스 없음 5개, rtw-* 7개 | 표대로 | 소스 없음 | 확인 불가 | – | – |

Google 토큰 저장 요약:

- **Drive: 전체에 1개**. `public_policy_drive_config` id=1 행(client id/secret/refresh token). 12곳이 읽고, 갱신은 `public-policy-drive:260` 한 곳(명진만). → 모든 작업공간의 자료실·회의·바구니·할 일 첨부·HWP 백업이 명진 Drive에 저장된다. **여러 사람으로 열기 전 가장 큰 구조 변경**(단계 ②의 '연결' 작업).
- 캘린더·할 일: 사람별(`app_google_calendar_connections`, `user_id`). 그대로 사용.
- OneDrive: 작업공간별(`app_onedrive_connections`). 그대로 사용.
- 비밀값: `COLLECTOR_FEED_SECRET`·`COLLECTOR_HEARTBEAT_SECRET`은 명진 수집기 전용, `WEB2_OPENAI_API_KEY`는 공용 비용(상한은 단계 ③).

### 2.3 화면 코드의 명진 고정 값 (값은 적지 않음)

| 종류 | 파일:줄 |
| --- | --- |
| 고정 작업공간 이름(이 이름이 아니면 기능이 꺼짐) | `app/ledger-export.js:18`, `app/ledger-auto.js:21`, `app/collection-status.js:114`, `app/drive-summary.js:89` |
| Web1 관리자 uuid | `app/web1-admin-auth.js:2` (Web1용, 유지) |
| 담당조직 이름 13개·묶음 5개 | `app/organization-order.js:8-16` |
| 자기 조직 이름 | `app/feed-model.mjs:153`(+끝말 규칙 `:154`) |
| 보고용 캘린더 이름(조직명) | `app/journal-weekly.js:118`, `app/calendar-plus.js:38`, `app/journal-hwpx.js:413` |
| 노조 양식 전제 문구 | `app/hwp-convert.js:14,54`, `app/hwp-lab.js:314-407,559`, `app/hwp-drive.js:22-23` |
| 개인 주소 | `app/web1-board.js:5-6`, `app/share-pages-model.mjs:28`, `app/auth-service.js:6`, `app/public-page-editor.js:7` |
| Drive 폴더 ID·메일·캘린더 ID·`press/` 경로 | app/ 코드에는 없음(폴더 ID는 DB `app_drive_settings` 등에 작업공간별) |

판정: 노조 서식·조직 이름·보고 캘린더 이름은 '노조 사람들이 모두 같은 조직'이라 대부분 그대로 써도 되지만, **담당조직 13곳(`organization-order.js`)과 보고 캘린더 이름은 사람마다 다르다** → 단계 ②에서 작업공간별 설정으로 옮길지 결정 필요(결정 D5).

## 3. 명진 전용 잠금 설계 (통화·텔레그램)

### 3.1 원칙

- 판정은 **DB 함수 하나**. 클라이언트가 보낸 user_id·workspace_id는 믿지 않고 `auth.uid()`와 서버 표만 본다(AGENTS.md 3절 3).
- 고정 uuid·고정 메일·고정 작업공간 이름을 판정에 쓰지 않는다(공개 저장소, 이름 바꾸면 깨짐). 허용 목록을 **서버 표**에 두고 그 표는 화면·API로 고칠 수 없게 한다(SQL Editor·승인형 DB workflow로만).
- 화면 숨김은 덤. 서버가 먼저 거절한다.
- 본인이 원해도 켜 주지 않음(요청 2번) → 허용 행을 넣는 RPC를 만들지 않는다.

### 3.2 판정 함수

- 새 표 `private.app_operator_features(workspace_id uuid, feature text, primary key(workspace_id, feature))`. private 스키마라 API 노출 없음. 행은 승인형 DB 적용으로 명진 작업공간에 `calls`, `telegram` 2행만 넣는다(작업공간 id는 SQL 안에서 현재 소유자 구성원 행으로 찾고, 문서·커밋에는 값을 적지 않음).
- 새 함수 `private.app_workspace_has_feature(p_workspace uuid, p_feature text) returns boolean` — SECURITY DEFINER, `search_path` 고정, `private.app_is_workspace_owner(p_workspace) and exists(허용 행)`.
- 이미 있는 `app_private_feature_access`(사람·기능 키, `app/myspace-return.js:7`가 읽음)를 다시 쓸 수 있는지 **먼저 운영 정의 확인**(정책 원문이 저장소에 없음). 쓰기가 authenticated에 열려 있으면 재사용하지 않는다. 같은 목적의 표를 두 개 만들지 않기 위해, 재사용 가능하면 그쪽으로 판정 함수를 만든다(AGENTS.md 4절).

### 3.3 막을 곳

| 대상 | 방식 |
| --- | --- |
| 통화 표 `app_feed_items`(source=call), `app_call_personal`, `app_call_edits`, `app_call_edit_history` | 기존 OWN 정책 위에 **restrictive 정책** `using (private.app_workspace_has_feature(workspace_id, 'calls'))` 추가. `app_feed_items`는 source별로 calls/telegram 판정 |
| 텔레그램 표 `app_feed_items`(source=telegram), `app_feed_days`, `app_tg_personal_days`, `app_tg_senders`, `app_tg_day_senders`, `app_feed_folders`, `app_feed_rooms`, `app_feed_room_days`, `app_feed_summary_edits`, `app_feed_summary_edit_history` | 같은 restrictive 정책('telegram') |
| authenticated RPC 14개(2.1 (다)) | 함수 첫 줄에서 판정 함수로 거절(DEFINER라 RLS를 거치지 않는 것이 있으므로 정책만으로는 부족) |
| service_role RPC 6개 | 인자로 받은 작업공간에 허용 행이 있는지 확인(수집기 비밀값이 새도 다른 작업공간에 쓰지 못하게) |
| 통화를 재료로 쓰는 원장 자동 기록 `app_ledger_auto_sources` | 통화 출처 행은 'calls' 허용 작업공간만(정책 또는 ai-assist 쪽 판정) |
| Edge `ai-assist` | `call_refill`·`org_people_brief`는 판정 RPC로 403. `ledger_auto`는 허용 없으면 통화 재료를 빼고 진행(표 정책이 이미 빈 결과를 주지만 명시적으로) |
| Edge `collector-feed` | 고정 작업공간 이름 대신 '비밀값 → 허용 행이 있는 작업공간'으로 찾음. 허용 행이 정확히 1개가 아니면 거절 |
| Edge `drive-summary` `heartbeat`·`ai_usage`·`status` | 고정 이름 대신 판정 함수. 다른 사람은 403 |
| 화면 메뉴 `app/menu-model.mjs:25-26`, PC `app/index.html:64-65`, 폰 `app/index.html:100-101`(`menu-layout.js:26-40`), 경로 `app/app-router.js:29`, `app/view-loader.js:39-40,180-182` | 시작 때 판정 RPC 한 번(공개 함수 `app_my_features()` — 내 작업공간의 기능 키 목록만 돌려줌)으로 메뉴에서 **삭제**(숨김 아님, 렌더 목록에서 뺌). 주소 직접 입력은 라우터가 '없는 화면'으로, 그래도 데이터는 서버가 거절 |
| 화면 고정 작업공간 이름 4곳(2.3) | 같은 `app_my_features()` 결과로 바꿈(원장 내보내기·원장 자동은 명진만인지 결정 D3) |

### 3.4 같이 막을 것 (분리 점검에서 나온 것)

- `app_create_invite`, `app_set_workspace_member_role`, `app_approve_access_request`, `app_reject_access_request`: authenticated 실행 회수(협업 제거 Task와 겹치면 그쪽에 합침). 여러 owner가 생기면 남을 자기 작업공간에 넣는 문이 되기 때문.
- `app_workspace_members` 쓰기: owner라도 다른 사람 행을 못 넣게(본인 owner 행은 가입 함수만 만듦). 단계 ②.
- `team-ai`: 첫 구성원 행 대신 owner 판정(또는 이미 쓰지 않으면 삭제 대상 확인).

### 3.5 확인 시험 (단계 ① 완료 기준)

- DB 시험: 두 번째 시험 사용자·작업공간을 만든 로컬 시험 DB에서 통화·텔레그램 표 select 0행, RPC 14개 모두 거절, 명진 작업공간은 그대로.
- Edge 시험: `ai-assist` `call_refill`이 허용 없는 작업공간에서 403.
- 화면 E2E: 기능 키가 없으면 메뉴에 통화·텔레그램 없음, `?view=calls` 직접 입력 시 빈 화면이 아니라 '없는 화면' 처리.

## 4. RTW(읽생기)와 Auth 공유 영향 (조사만)

- 같은 `auth.users`를 쓴다. Auth의 Google 로그인·가입 허용은 프로젝트 전체 설정이라 RTW와 같이 바뀐다(`docs/web2-bundle-a-investigation.md:137-143`, `docs/design/mcp-claude-read.md:86`).
- 지금도 Google 계정이면 누구나 Auth 계정이 생긴다(가입을 막지 않음). Web2는 구성원 행이 없으면 접근 거부 화면(`app/loader-v2.js:110-128`, `app/team.js:85`). 가입 때마다 `app_profiles` 행이 생긴다(운영 트리거, `docs/web2-account1-env6-investigation.md:50`).
- RTW 표는 `owner_id = auth.uid()`에 더해 베타 허용 목록(`private.rtw_has_beta_access()`, `rtw_beta_access` 메일 목록)으로 막혀 있다(`docs/design/rtw-note-unify-investigation.md:116-135`, 원장 RTW-2). **그래서 Web2 가입자가 RTW 자료를 쓰거나 보지는 못한다.**
- 영향이 있는 곳:
  1. RTW 탈퇴 함수 `rtw-delete-account`가 'Web2 계정인지'를 `app_workspace_members`·`app_profiles`로 판정한다. Web2 가입자가 늘면 판정이 달라질 수 있다 → 읽생기 저장소에서 확인(이 저장소에서 고치지 않음).
  2. Web2 가입 때 작업공간을 자동으로 만들면, **RTW만 쓰려고 로그인한 사람에게도 Web2 작업공간이 생긴다**.
- 막는 방법(추천 순):
  - 가) Web2 작업공간 생성은 **Web2 로그인 화면에서 부르는 서버 함수**로만(Auth 가입 트리거로 만들지 않음). RTW 로그인으로는 생기지 않는다.
  - 나) 그 함수에 '가입 허용 여부'(전체 열기/닫기, 정지 목록)를 서버 표로 둔다. Auth 설정은 바꾸지 않는다.
  - 다) Auth 설정에서 가입을 끄는 방법은 RTW 신규 가입도 막으므로 쓰지 않는다.

## 5. 구글 앱 상태 확인 방법 (명진이 직접, 읽기만)

PC 브라우저가 편하다(폰도 가능).

1. 브라우저에서 `console.cloud.google.com` 을 열고, Drive를 연결한 구글 계정으로 로그인한다.
2. 화면 맨 위 왼쪽의 **프로젝트 이름 칸**을 눌러, Web2 로그인·Drive 연결에 쓰는 프로젝트를 고른다.
3. 왼쪽 위 ☰ 메뉴 → **Google 인증 플랫폼**(영문 화면이면 Google Auth Platform)을 누른다. 예전 화면이면 'API 및 서비스 → OAuth 동의 화면'.
4. 왼쪽 메뉴 **대상**(Audience)을 누른다. 맨 위 '게시 상태'가 **테스트 중**인지 **프로덕션 단계**인지 본다. 아래 '테스트 사용자' 목록도 함께 캡처한다(메일이 보이므로 캡처는 채팅에만 보내고 저장소에는 올리지 않음).
5. 왼쪽 메뉴 **데이터 액세스**(Data access)를 눌러 등록된 권한 목록을 캡처한다.
6. 왼쪽 메뉴 **인증 센터**(Verification Center)를 눌러 '인증 상태'를 캡처한다.

읽는 법:

- '테스트 중'이면: 등록한 테스트 사용자만 연결할 수 있고, 연결이 **7일마다 풀린다**. 노조 사람이 쓰려면 명진이 4번 화면에서 그 사람 메일을 하나씩 넣어야 한다 → 실사용 전에 '프로덕션으로 게시' 필요.
- Web2가 요청하는 권한: Drive는 `drive.file`(민감 아님), 일정은 `calendar.events`·`calendar.calendarlist.readonly`, 할 일은 `tasks`(이 둘은 '민감' 등급)(코드 근거 `public-policy-drive/index.ts:126-135`, `google-calendar/index.ts:83`, `google-tasks/index.ts:67-69`). 유료 보안 심사가 필요한 '제한' 등급(`drive` 전체 등)은 요청하지 않는다.
- 프로덕션으로 게시만 하고 심사를 안 받으면: 사용자 100명까지 '확인되지 않은 앱' 경고(고급 → 계속)를 거쳐 쓸 수 있다. 10명 이내라 당장은 가능하지만 노조 사람들에게 경고 화면을 넘기는 법을 안내해야 한다.
- 경고를 없애려면 **민감 권한 인증(무료)**: 3번 화면 → 브랜딩(앱 이름·로고·홈페이지·개인정보처리방침 주소·도메인 확인) 채우기 → 인증 센터 → 인증 제출. 개인정보처리방침 페이지(Web1)와 도메인 소유 확인이 필요하다. 이 단계는 단계 ②의 '연결' 작업 앞에 넣는다(결정 D4).
- 프로덕션으로 바꾸는 버튼(4번 화면 '앱 게시')은 **누르지 않는다** — 커맨드센터 승인 뒤 단계 ②에서.

## 6. 단계 ①의 PR 나누기, 위험, 결정 필요

### 6.1 PR 나누기 (모두 맨 뒤 순서, 대기 줄이 빌 때)

| 순서 | PR | 내용 | 정지 지점 |
| --- | --- | --- | --- |
| ①-0 | 운영 조회(💻 PC 로컬 또는 📱 폰 경로 C 확인 SQL) | 원문 없는 기본 표 약 20개·운영 전용 함수·트리거·`app_private_feature_access` 정책 catalog 조회 → 이 문서 2.1 (나) 빈칸 채우는 문서 PR | 없음(읽기만) |
| ①-1 | DB(📱 폰 경로 C 또는 승인형 DB workflow) | 판정 표·함수, 통화·텔레그램 restrictive 정책, RPC 20개 판정 추가, `app_my_features()`, 협업 함수 실행 회수. 짝 파일(rollback·snapshot) 포함 | **적용 직전 정지**(AGENTS.md 6·7절). 되돌리기=rollback SQL로 정책·함수 원복, 허용 행 삭제 |
| ①-2 | Edge | `ai-assist`(통화 action 판정), `drive-summary`·`collector-feed`(고정 이름 → 판정) | **배포 직전 정지**(8절, verify_jwt 유지). 되돌리기=이전 운영 소스 SHA 재배포. ①-1 적용 뒤 |
| ①-3 | 화면 | 메뉴·라우터가 `app_my_features()`를 따름, 고정 작업공간 이름 4곳 교체, E2E 추가, 업데이트 기록 파일 | 없음(Pages 배포). ①-1 뒤 |

순서: ①-0 → ①-1 → ①-2·①-3(병렬 가능). 명진 작업공간에 허용 행을 넣는 것이 ①-1 안에 있어야 명진 화면이 끊기지 않는다(Expand → Deploy → Verify → Contract, `docs/web2-expand-deploy-verify-contract.md`).

### 6.2 위험

- 명진 화면 끊김: 허용 행 없이 정책만 적용되면 명진도 통화·텔레그램이 0건으로 보임 → 같은 트랜잭션에서 허용 행을 먼저 넣고, 사후 확인 SQL로 명진 건수 비교.
- 수집 끊김: `collector-feed` 교체 시 고정 이름 → 판정 전환이 틀리면 수집이 멈춤 → 배포 후 heartbeat·하루 건수 확인.
- 원문 없는 정책: 기본 표 일부의 운영 정책을 모른 채 열면 분리가 깨질 수 있음 → ①-0 없이는 단계 ②로 가지 않는다.
- Drive 단일 연결: 단계 ① 잠금과 무관하게, **Drive 사람별 연결(단계 ②) 전에는 다른 사람을 들이면 안 된다**(파일이 명진 Drive로 감, 바구니 폴더 섞임).
- 단계 ① 자체는 다른 사람이 없을 때 적용하므로 사용자 영향은 명진 한 명뿐.

### 6.3 명진 결정 필요

| 번호 | 결정(일상어) | 추천 |
| --- | --- | --- |
| D1 | 위 1.3 규칙 문장(각자 자기 작업공간, 통화·텔레그램은 서버가 명진만)으로 규칙을 바꿀까요? | 예 — 단계 ② 시작 PR에서 반영 |
| D2 | 명진 전용 판정을 '서버 허용 표'(화면에서 못 고침, SQL로만)로 할까요? | 예 — 고정 아이디를 코드에 박지 않음 |
| D3 | 원장 내보내기·원장 자동 기록·수집 상태 화면도 명진만인가요, 다른 사람도 자기 것으로 쓰나요? | 원장 자동 기록·내보내기는 모두 쓰게(통화 재료만 빠짐), 수집 상태는 명진만 |
| D4 | 구글 앱을 '프로덕션'으로 올리고 무료 인증(경고 없애기)을 단계 ② 앞에 넣을까요? | 예 — 먼저 5절대로 지금 상태 캡처만 보내 주세요 |
| D5 | 담당조직 13곳·보고 캘린더 이름을 사람마다 따로 정하게 할까요? | 예 — 단계 ②에서 각자 설정, 명진 값은 그대로 이전 |

## 7. 범위 밖 발견사항 (고치지 않음)

1. `pc0914-checklist`(Web1): Origin 헤더가 없으면 인증 없이 service role로 체크리스트를 고칠 수 있다. 의도인지 확인 필요.
2. `event-media` `list`: `event_id` 없이 부르면 모든 작업공간 사진 행을 service role로 읽은 뒤 거른다(유출은 아님, 여러 사람이 되면 효율·구조 문제).
3. `share-page-media`: CORS `*`(JWT로 막혀 위험 낮음).
4. `public-policy-drive:110`, `meeting-ai-draft:33-38`, `library-files` 회의 등록, `event-media` 지우기, `team-ai` 정밀 모드에 옛 admin/editor 역할 분기가 남아 있다(협업 제거 Task 대상).
5. `basket-files`·`library-files`·`onedrive-photos`·`task-files`는 '구성원 행 1개'를 가정해 한 사람이 작업공간 둘이면 403/503. 사람당 작업공간 1개 규칙이면 문제 없음.
6. `app_spaces`는 사람(`owner_id`) 기준, 나머지는 작업공간 기준 판정. 기준이 둘이다.
