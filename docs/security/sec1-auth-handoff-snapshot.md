# SEC-1 read-only snapshot

조회: 2026-09-26 UTC, 기록: 2026-09-27 KST. main `8a6f4ec58d57e8a39f952eb6d7398e1ae34435ae`.

| 항목 | 조회 결과 |
| --- | --- |
| auth-handoff | ACTIVE / version 3 / verify_jwt false |
| updated_at | 2026-09-12 00:13:10.751 UTC |
| public.app_auth_handoff_consumptions | 없음 (`to_regclass` null) |
| public.app_consume_auth_handoff(uuid,uuid,timestamptz) | 없음 (`to_regprocedure` null) |
| handoff/nonce 이름의 public/private 함수 | 없음 |
| service_role의 private schema USAGE | false |
| service_role의 public schema USAGE | true |
| private.app_is_workspace_owner | 인자 p_workspace uuid; SECURITY DEFINER; authenticated/service_role execute 존재. 변경하지 않음 |
| 기존 후보 저장 구조 | app_bootstrap_tokens: workspace PK; app_drive_download_tokens: document FK; app_google_oauth_states: Google callback용 hash/user/expiry |

최근 로그는 아래 **한정된 24시간**만 확인했다. 두 source 모두 auth-handoff 해당 행이 없었다. 최근 24시간 호출 0건이며 장기 미사용 판정은 아니다. 과거 ENV-6 조사 기록을 새 조회 결과로 간주하지 않는다.

- 시작: `2026-09-25T14:58:36Z`
- 종료: `2026-09-26T14:58:36Z`
- `function_edge_logs`, `function_logs`에서 대상 function_id 필터 후 count 집계. 원문 URL/query/header/body/사용자 식별자는 출력·저장하지 않음.
- 원본 조회는 MCP `get_edge_function`으로 했고, 호출용 seal/consume 요청은 production에 보내지 않았다.

적용 전 재조회할 최소 SQL(조회만):

```sql
select to_regclass('public.app_auth_handoff_consumptions')::text as proposed_table,
       to_regprocedure('public.app_consume_auth_handoff(uuid,uuid,timestamp with time zone)')::text as proposed_rpc,
       has_schema_privilege('service_role','public','USAGE') as service_public_usage;

select nspname, has_schema_privilege('service_role',oid,'USAGE') as service_usage
from pg_namespace where nspname='private';

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       p.prosecdef, p.proacl::text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname ilike '%handoff%';
```

새 객체가 이미 존재하면 초안을 덮어 적용하지 말고 정의·권한·이력 차이를 검토한다. 정식 migration 승격 시 schema_migrations의 해당 version 부재, 새 표 ACL/RLS/default privileges, service_role BYPASSRLS와 RPC 실행 권한을 다시 snapshot에 포함해야 한다. 이번 문서는 미적용 초안용 snapshot이며 실제 적용 시점의 사전 검증을 대체하지 않는다.
