# SEC-1 read-only snapshot

## 후속 후보 사전 조회 및 로컬 검증 (2026-09-27 KST)

기존 조사 반복 대신 이번 변경의 최소 사전 조건만 production에서 read-only로 재확인했다.

| 항목 | 후속 조회 결과 |
| --- | --- |
| PostgreSQL 버전 | 17.6 |
| 새 표 / RPC | 둘 다 없음 |
| migration `20260926154120` | 기록 없음 |
| service_role public USAGE / private USAGE | true / false |
| service_role BYPASSRLS | true (기존 역할, 변경 안 함) |
| public default table ACL | postgres 생성 객체에 anon/authenticated/service_role ALL이 기본 부여됨 |
| public default function ACL | postgres 생성 객체에 anon/authenticated/service_role EXECUTE 기본 부여됨 |

따라서 새 표/RPC 생성 직후 명시적으로 REVOKE하고 service_role 최소 권한만 다시 부여한다.
정식 후보는 CLI 2.118.0이 생성한 `20260926154120_sec1_auth_handoff_once.sql`이다.
forward와 rollback은 이제 실제 실행 가능한 transaction 후보이며 마지막은 `commit;`이다.
**production에는 실행하지 않았다.** 아래는 운영 결과와 구분한 로컬 결과다.

- PostgreSQL 17.6 새 임시 클러스터, loopback 전용 연결. 위 hosted default ACL과 service_role BYPASSRLS를 재현했다.
- RPC `prosecdef=false`(INVOKER), 표 `relrowsecurity=true`. PUBLIC 상속 전용 역할·anon·authenticated의 SELECT/INSERT/DELETE/RPC를 실제 실행하여 모두 권한 거부.
- service_role INSERT/DELETE + SELECT(nonce, expires_at) + RPC EXECUTE로 동작. subject_id SELECT, UPDATE, TRUNCATE는 실제 거부.
- 20개 독립 handler/DB backend 동시 사용: 소비 성공 1개, refresh 1회, 거부 19개. 순차 재사용·다른 인스턴스·Auth 실패/DB 응답 유실 후 재사용 거부.
- 후보 적용 → 실제 역할/동시성 시험 → rollback으로 새 객체/이력만 제거 → 재적용 성공.
- 토큰/키/사용자 실제 식별자는 입력하거나 출력하지 않았다. Auth와 REST transport는 합성이고 DB 쿼리·제약/권한·동시 연결은 실제다.

적용 직전에는 아래 원래 SQL에 더해 migration 이력 부재, default ACL, 역할 특성을 다시 확인한다.
운영 Edge version/verify_jwt는 이번 후속에서 재조회하지 않았다. 아래 값은 이전 조사 기록이다.

## 최초 조사 기록

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

새 객체가 이미 존재하면 덮어 적용하지 말고 정의·권한·이력 차이를 검토한다. 이 snapshot은 실제 적용 시점의 사전 검증을 대체하지 않는다.
