-- MCP-Claude읽기 M-3 L1·L2 사전 확인(SELECT만, 카탈로그만 — 행 값·기록 내용 없음). CC가 SQL Editor 새 창 또는 조회 전용 MCP에서 실행한다.
-- 읽는 법: 모든 'ok' 칸이 true여야 apply로 간다. 'switch_roles'는 authenticator가 바꿔 탈 수 있는 역할 이름 목록(anon·authenticated·service_role 밖이 있으면 멈춤),
-- 'realtime_tables'는 실시간 구독 표 이름 목록이다(비어 있지 않으면 OAuth 서버를 켜기 전에 CC가 막을 방법을 정한다 — 설계 4.3. 이 파일 적용 자체는 막지 않음).
select
  (select count(*) = 1 from supabase_migrations.schema_migrations where version = '20261120090000' and name = 'mcp_claude_read') as ok_migration_applied,
  not exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
              where r.rolname = 'authenticator' and x.v like 'pgrst.db\_pre\_request=%') as ok_pre_request_unset,
  to_regprocedure('public.app_mcp_pre_request()') is null as ok_function_absent,
  not exists (select 1 from pg_policy p where p.polname in ('app_mcp_no_delegated_storage', 'app_mcp_no_delegated_buckets')) as ok_policies_absent,
  to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null as ok_storage_tables_present,
  to_regprocedure('auth.jwt()') is not null and has_function_privilege('anon', 'auth.jwt()', 'execute')
    and has_function_privilege('authenticated', 'auth.jwt()', 'execute') and has_function_privilege('service_role', 'auth.jwt()', 'execute') as ok_auth_jwt_callable,
  not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
              where m.member = (select oid from pg_roles where rolname = 'authenticator')
                and r.rolname not in ('anon', 'authenticated', 'service_role')) as ok_switch_roles_known,
  (select string_agg(r.rolname::text, ',' order by r.rolname) from pg_auth_members m join pg_roles r on r.oid = m.roleid
    where m.member = (select oid from pg_roles where rolname = 'authenticator')) as switch_roles,
  (select coalesce(string_agg(t.schemaname || '.' || t.tablename, ',' order by t.schemaname, t.tablename), '') from pg_publication_tables t
    where t.pubname = 'supabase_realtime') as realtime_tables;
