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
| `20260926154120_sec1_auth_handoff_once.sql` | 적용 완료·기록 존재 (2026-09-27 KST Task 20 read-only 재확인) | version `20260926154120`, name `sec1_auth_handoff_once` 일치. SEC-1 #324 운영 DB·Edge 적용 완료(사용자 확인). auth-handoff v4·verify_jwt=false, 배포 소스와 저장소 원문 일치. Android 실물 검증 보류. 이 세션은 조회만 수행 |

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
