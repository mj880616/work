# production migration 기록 대응표

- 조사일: 2026-09-26 (ENV-2)
- 조사 기준: 저장소 `main` `d187ffb`, production `supabase_migrations.schema_migrations` 135행
- 조사 방법: 로컬 세션 read-only 조회. 본문은 공백 제거 후 md5로 비교했다.

## 방침

- production DB는 이 저장소(work)와 읽생기(read-think-write) 저장소가 함께 쓴다.
  어느 저장소의 `supabase/migrations/`도 production 기록 전체를 담지 않으므로 `supabase db push`는 구조적으로 쓸 수 없다.
- `supabase db push`와 `supabase migration repair`는 영구 금지한다.
- 저장소 파일 이름과 production 기록 버전을 소급해서 맞추지 않는다. 불일치는 이 문서의 대응표로 관리한다.
- 앞으로의 적용은 `AGENTS.md` 7절 "production DB 적용" 절차를 따르고, 적용 SQL 안에서 기록 1행을 저장소 파일과 같은 버전으로 insert한다.

## 대조 결과 요약

### ENV-2 이후 적용 기록

| 저장소 파일 | production 상태 | 비고 |
| --- | --- | --- |
| `20261020051027_journal_work_lines.sql` | 적용 완료(2026-10-20 승인형 DB workflow: dry-run run 39385510241 사전 확인 모두 예상대로 → apply run 39386006486 success, 사용자 실기기 두 줄 저장 확인) | JOURNAL-오늘한줄목록. 업무일지 검사 조건 `app_notes_work_line_check` 하나만 바꿈: 하루 1행(`app_notes_journal_day_unique`) 그대로, 본문 = 줄 1~50개를 `\n` 하나로 이음, 줄마다 1~300자(빈 줄·`\r` 없음), 첨부 없음. 새 열·색인·함수·grant·정책·RLS 변경·기존 행 변경 없음. 사전 확인에서 선행 기록 `20261017052234`·owner 정책·anon/PUBLIC 표 권한·트리거·하루 1행 색인이 다르거나 새 규칙에 안 맞는 업무일지 행이 있으면 멈춤. 짝 rollback은 두 줄 이상인 날이 있으면 멈춤(데이터 삭제 없음). 승인형 DB workflow 검사 통과(표 1개·함수 0개). 로컬 PostgreSQL 17.6에서 workflow runner로 dry-run·apply·줄 규칙·owner RLS·rollback 차단·rollback·재적용·사전조건 차단 확인. |
| `20261020005000_share_pages_links.sql` | 적용 완료(사용자 보고, 2026-10-20 SQL Editor, 폰 경로 C; 사전 확인 9항목·사후 확인 7항목 모두 “예”) | SHARE-현장공유 PR 1(서버). 새 표 `app_share_pages`(제목·블록 jsonb 6종·초안/게시·선택 프로젝트 연결)와 `app_share_page_links`(받는 사람별 링크, DB가 만든 64자 링크 값·sha256 지문·이름표·기한·끔). RLS 켜고 owner 정책 각 1개(`private.app_is_workspace_owner`), PUBLIC·anon·authenticated·service_role 기본 권한 전부 회수 뒤 authenticated는 읽기·삭제와 필요한 칸만 쓰기(링크 값·지문·페이지 옮기기 불가), service_role은 읽기 함수에 필요한 칸만 SELECT(링크 원문·workspace 불가). 새 함수·기존 표·정책 변경 없음. 정책·표 grant가 있어 승인형 DB workflow 검사가 거절하므로 **SQL Editor(폰 경로 C) 전용**. 짝 rollback은 공유 페이지·링크가 하나라도 있으면 멈춤. 로컬 PostgreSQL 17.6에서 apply·RLS·칸 권한·읽기 함수·rollback·재적용 확인. |
| `20261018112943_doc_categories_profile.sql` | 운영 적용 완료(2026-10-19, 사후 검사 확인) | UI-바구니첨부메모 PR 2b(사용자 결정 B-1). `app_profiles.document_categories`(text[], 기본 7개 교섭·투쟁·교육·선전·정책·회의·기타)와 검사 조건(1~30개, 이름 1~20자, 빈 값·앞뒤 공백·제어문자·쉼표·중복 금지, '기타' 필수). SECURITY INVOKER·`search_path = ''` 함수 3개(`app_document_category_add(text)`·`_rename(text,text,text[])`·`_delete(text,text[])`), 대상은 `auth.uid()`의 내 프로필 행뿐, PUBLIC·anon·service_role 회수 후 authenticated만 실행. 이름 바꾸기는 내 업무공간 자료의 분류도 새 이름으로, 삭제는 그 분류 자료를 '기타'로(owner RLS 그대로). '기타'는 이름 바꾸기·삭제 불가. 표 grant·정책·RLS 변경 없음. 선행 기록 `20261018032038`. 사전 확인에서 authenticated의 `app_profiles` UPDATE 권한·task12a 정책 2개 모양·`private.app_is_owner_profile` 본문·소유자 프로필 행이 다르거나 폐기 번호 `20261018023753` 기록이 있으면 멈춤. 짝 rollback은 분류 목록이 기본 7개와 다른 프로필이 있으면 멈춤(목록·자료 값 삭제 없음). 로컬 PostgreSQL 17.6에서 workflow runner로 dry-run·apply·함수·CHECK·rollback 차단·rollback·재적용·사전조건 차단 확인. |
| `20261018032038_doc_organization_link.sql` | 운영 적용(2026-10-18, 승인형 DB workflow dry-run 성공 → apply 성공, 백업 표 `ops_backup.20261018032038_app_documents_*`, 사후 검사 5개 모두 예) | UI-바구니첨부메모 PR 2a. `app_documents.organization_id`(nullable, `app_suborganizations` 삭제 시 연결만 비움)·부분 색인, 기존 owner 정책 `task12a_owner_all`의 WITH CHECK에 "같은 workspace의 조직"만 추가(USING·역할 그대로). 새 함수·표 grant·새 정책·RLS 변경·기존 행 변경 없음. 선행 기록 `20261012100000`. 사전 확인에서 정책 모양·anon/PUBLIC 표 권한이 다르거나 폐기 번호 `20261018023753` 기록이 있으면 멈춤. 짝 rollback은 조직 연결이 있으면 멈춤(데이터 삭제 없음). 로컬 PostgreSQL 17.6에서 workflow runner로 dry-run·apply·RLS·rollback·재적용 확인. |
| `20261018023753_doc_org_categories.sql` | 폐기·운영 미적용(파일 삭제) | 2026-10-18 승인형 DB workflow dry-run run #21에서 사전 확인 "authenticated can update workspaces = 아니오"로 멈춤(운영 변경 없음). 권한 확대 없이 나눠 진행: 담당조직 칸은 `20261018032038_doc_organization_link`로 다시 준비, 분류 목록 저장(`app_workspaces.document_categories`·함수 4개)은 보류(UI-바구니첨부메모 2b 조사). workflow가 옛 번호를 고를 수 없도록 migration·짝 파일을 지웠다. 이 번호로 기록이 생기면 안 되며, 새 migration 사전 확인이 이 번호의 기록이 있으면 멈춘다. |
| `20261017052234_journal_memo_notes_kind.sql` | 운영 적용됨(2026-10-19 읽기 전용 조회: `app_notes`의 kind·title·metadata 열 3개와 `schema_migrations` 기록 1행 확인) | MEMO-노트·JOURNAL-일지 0단계. `app_notes`에 `kind`(basket·note·work·diary, 기존 행 basket)·`title`(노트만)·`journal_day`(업무일지·일기만) 열, 검사 조건 5개 추가와 본문 규칙 교체(노트 10만 자), 색인 2개. 새 함수·grant·정책·RLS 변경 없음. 사전 확인에서 anon/PUBLIC 표 권한·트리거·정책 수가 다르면 멈춤. 짝 rollback은 노트·업무일지·일기 행이 있으면 멈춤(데이터 삭제 없음). 로컬 PostgreSQL 17.6에서 workflow runner로 dry-run·apply·rollback·재적용 확인. |
| `20261016201647_prj_color_check.sql` | 준비중·운영 미적용 | PRJ-색. 기존 `app_spaces.metadata`(jsonb) 재사용, 새 칸 없음. `metadata.color`를 8개 키(green·blue·orange·purple·pink·yellow·red·gray)로만 허용하는 CHECK `app_spaces_metadata_color_check` 1개. owner/RLS/정책/grant 변경 없음. 사전 확인에서 잘못된 color 값이 있으면 멈춤. 로컬 PostgreSQL 16에서 apply·dry-run·rollback·재적용 차단 확인. 짝 rollback은 검사만 제거(저장된 색 값 유지). |
| `20261013034836_basket_photo_ocr_db.sql` | 준비중·운영 미적용 | #516 Draft. 2026-10-13 실제 CLI 생성 version. 선택 OCR attachment metadata·단일 owner INVOKER CAS 준비. 기존 service-role 업로드/owner RLS/원문/요약 함수 보존. 운영 버전/trigger/default 함수 ACL 미확인으로 failclosed. 전체 schema 조회 전 독립 version SELECT로 PostgreSQL16+ 문법 전제 확인(실제 격리 검증17.6, 16 전체 지원 검증 아님); [사용 전 rollback·사용 후 보존/forward fix](20261013034836_basket_photo_ocr_db.recovery.md). DB/Edge 운영 적용·사진 읽기 화면 활성화 없음. |
| `20261012100000_basket_link_view_db.sql` | 적용 완료(2026-10-12, 사용자 승인형 DB workflow dry-run #12 → apply #13) | #506 merge/source `dcc413b5ca442bc16fa5c90d32a11c0153e0df50`. [dry-run](https://github.com/mj880616/work/actions/runs/38262646060) 이전 상태 유지·성공, [apply](https://github.com/mj880616/work/actions/runs/38263344890) 사전7/사후7항목 모두 예·migration 1행. 백업 `ops_backup.20261012100000_app_record_links_38263344890`. nullable 연결 summary·기존 확정 서명/호출 호환·소유자 CAS 수정 RPC. 화면/Edge 변경 없음. [보존·원자적 SQL Editor 복구·조건부 복원](basket-link-view-db-review.md) CC 검토 완료. 기존 함수 복원을 금지하는 현 정책상 rollback 버튼은 사용 불가. 사용자 캡처와 실행 SHA/모드로 적용 확인, CC 직접 운영 접속·DB 쓰기 없음. |
| `20261011180000_basket4a_confirm_links.sql` | 적용 완료(2026-10-11 사용자 보고; 2026-10-12 선행 기록·정의 확인) | 조직·프로젝트 선택 확정 RPC만 추가. SECURITY INVOKER·빈 search_path·public/anon revoke 뒤 authenticated 실행권한. 기존 owner RLS·표·원문 유지. [검토·사전/사후·snapshot·정확한 함수 rollback](basket-4a-review.md). 이전 구현 세션 운영 조회·적용·workflow 실행 없음. 2026-10-11 사용자 승인형 apply 성공은 원장 기록 기준이며, 2026-10-12 연결보기 dry-run/apply에서 기존 기록·정확한 4a 정의 일치를 다시 확인. |
| `20261010180000_basket2_drive_folder.sql` | 적용 완료 (2026-10-10, 승인 버튼 apply, 2차 실행) | nullable `basket_folder_id text`만 추가, owner/RLS/grant 변경 없음. 기존 settings 생성 정의는 저장소에 없어 catalog precheck·snapshot 확인 필수. [승인 버튼 dry-run → apply → Edge 최초 배포 → 화면 순서](basket-2a2-server-apply.md). 사용자 실행: dry-run 성공 → apply 1차 사전 기록 확인 실패(요청 미전송) → 2차 성공. ops_backup.20261010180000_app_drive_settings_<run_id> 백업 생성, 사후 검사 모두 예. 이 기록은 사용자 보고 기준이며 이번 화면 PR에서 운영 조회·적용 없음. |
| `20261010120000_basket1_notes_links.sql` | 적용 완료(사용자 보고, 2026-10-10 SQL Editor, 폰 경로 C; 사후 확인 13항목 모두 “예”) (BASKET-1) | version `20261010120000`, name `basket1_notes_links`. 메모 첨부/보관/AI 포함/metadata 및 자료 대상 확장. 로컬 적용→rollback→재적용 검증, 운영 조회·적용 없음. [폰 경로 C 안내·snapshot·rollback](basket-1-apply.md). 커맨드센터 승인·사용자 SQL Editor 실행 직전 정지. |
| `20260926154120_sec1_auth_handoff_once.sql` | 적용 완료·기록 존재 (2026-09-27 KST Task 20 read-only 재확인) | version `20260926154120`, name `sec1_auth_handoff_once` 일치. SEC-1 #324 운영 DB·Edge 적용 완료(사용자 확인). auth-handoff v4·verify_jwt=false, 배포 소스와 저장소 원문 일치. Android 실물 검증 보류. 이 세션은 조회만 수행 |
| `20260927103344_task_impl2_notes_record_links.sql` | 적용 완료·기록 존재 (2026-09-27 운영 적용, read-only 사후 확인) | TASK-구현 PR 2(#335, main `7f13105e`). `app_notes`·`app_record_links` 생성. version `20260927103344`, name `task_impl2_notes_record_links` 일치. 사후 확인 전 항목 일치(RLS 켜짐, 정책 각 1개, anon 권한 없음, authenticated select·insert·update·delete, 행 0). 적용 절차·되돌리기는 `docs/web2-task-impl2-db.md` |
| `20260929081500_task29_block_writes_delete_app_tasks_rows.sql` | 적용 완료(사용자 보고, 2026-09-29 SQL Editor) | TASK-29 #360·#361 merge 뒤 새 쿼리 창에서 적용. 사용자 보고 사후 확인: `app_tasks` 0행, `authenticated` SELECT만 허용, migration 기록 1행. 첫 실행은 편집기에 남아 있던 옛 쿼리가 실행되어 이 migration이 미적용이었고, 당시 운영 변화 없음 확인 후 새 쿼리 창에서 재실행. 이 문서 갱신 세션은 DB를 재조회하지 않았다. |
| `20260929072329_task29_delete_app_tasks_rows.sql` | 미적용 | #359의 구 파일은 #360에서 저장소에서 제거하고 `20260929081500`으로 대체. 사용자 보고 기준 production 기록 없음. |

아래 ENV-2 집계는 당시 조사값이며 위 후속 적용을 소급 포함하지 않는다.

| 분류 | 건수 |
| --- | --- |
| 버전 일치 | 10 |
| 버전만 다름 | 7 |
| 저장소에만 있음 | 1 |
| production 기록에만 있음 | 118 |

버전 일치 10건과 버전만 다른 7건은 production 기록의 SQL 본문이 저장소 파일과 같다.
`20260916030032`, `20260916031003`, `20260916064219`, `20260916065108` 4건은 저장소 파일에 붙은 `--` 주석 헤더만 다르다.

### 버전 일치 (10건)

`20260916030032`, `20260916031003`, `20260916064219`, `20260916065108`, `20260916093800`,
`20260918133933`, `20260920120000`, `20260920121000`, `20260920122000`, `20260925032810`

### 버전만 다름 (7건)

| 저장소 파일 버전 | production 기록 버전 | 이름 |
| --- | --- | --- |
| `20260917113000` | `20260917113447` | expose_authenticated_page_edit_check |
| `20260921050000` | `20260920222753` | public_workspace_forward_repair |
| `20260921231000` | `20260921145003` | fix_project_delete_workstream_unlink |
| `20260923074619` | `20260923102614` | web2_project_owner_only |
| `20260925060000` | `20260924233847` | 저장소 remove_web2_push_delivery / production remove_web2_notifications_and_push (본문 동일) |
| `20260925084844` | `20260925113810` | task12a_sole_owner_db |
| `20260925143746` | `20260925165805` | task13_web2_private_boundary |

### 저장소에만 있음 (1건): Web1-4

- `20260926004103_web1_4_drop_app_delete_pages`: 2026-09-26 SQL Editor로 적용했고 기록은 남기지 않았다.
- 실제 DB 반영 확인: `public.app_delete_pages` 함수 없음, `public`·`private` 함수 본문 참조 0건.
- 이 함수는 기록된 `20260914112817_atomic_page_delete`에서 만들어졌고, 삭제 기록은 없다.

### production 기록에만 있음 (118건)

| 구분 | 건수 | 내용 |
| --- | --- | --- |
| 저장소 시작 이전 | 88 | `20260909032812` ~ `20260916015756`. 이 저장소 이력에 파일 없음 |
| 파일 없는 이후 기록 | 22 | 아래 목록. 두 저장소 어디에도 파일 없음 |
| 읽생기 저장소 소관 | 8 | 아래 표 |

파일 없는 이후 기록 22건:
`20260917095743` rtw_phase1_foundation, `20260917111916` create_rtw_owner_setup_state, `20260917113805` rtw_owner_claim_hash,
`20260918000711` web2_restrict_access_request_rpc_to_authenticated, `20260918000747` web2_restrict_access_request_rpc_public_grant,
`20260918052721` add_rtw_bookmarks, `20260918130014` create_rtw_ai_usage, `20260918130022` add_rtw_ai_quota_function,
`20260918130354` harden_cross_tenant_resource_links, `20260918130705` make_reading_resources_private_per_user,
`20260918131202` remove_legacy_rtw_single_owner_state, `20260918131240` add_rtw_self_data_deletion,
`20260918132054` harden_rtw_function_permissions, `20260918132447` limit_rtw_record_sizes,
`20260918132606` add_rtw_multiuser_query_indexes, `20260918135431` remove_rtw_recommendation_usage,
`20260918142105` drop_legacy_public_policy_materials, `20260918142311` add_rtw_personal_mode_owner,
`20260918142837` add_rtw_personal_owner_check, `20260918142927` enforce_rtw_personal_mode_core_rls,
`20260918142938` enforce_rtw_personal_mode_related_rls, `20260919040647` add_custom_note_types

읽생기 저장소 소관 8건:

| production 기록 버전 | 읽생기 저장소 파일 버전 | 이름 | 상태 |
| --- | --- | --- | --- |
| `20260919020945` | `20260919020945` | add_reading_records_and_writing_context | 일치 |
| `20260919021556` | `20260919021556` | index_rtw_records_source_resource | 일치 |
| `20260920005250` | `20260920005250` | allow_custom_note_types | 일치 |
| `20260920012755` | `20260920012755` | manage_note_types_safely | 일치 |
| `20260921225321` | `20260921225321` | add_resource_delete_rpc | 일치 |
| `20260920190745` | `20260921043000` | enable_multiuser_personal_spaces | 버전 다름 |
| `20260920193613` | `20260921050000` | add_free_beta_controls | 버전 다름 |
| `20260921015142` | `20260921105500` | add_beta_access_status_rpc | 버전 다름 |

버전이 다른 3건은 RTW 트랙 소관이다(`docs/roadmap.md` 별도 트랙: RTW).
