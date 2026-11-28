-- MCP-Claude쓰기 L1 허용 목록 넓히기 사전 확인(SELECT만, 카탈로그만). CC가 SQL Editor 새 창 또는 조회 전용 MCP에서 실행한다.
-- 읽는 법: 모든 'ok' 칸이 true여야 apply로 간다. ok_old_list가 false면 요청 전 함수가 3판 모양이 아니다(이미 넓혔거나 다른 함수) → 멈춤.
-- 적용 순서: 20261128100000_mcp_claude_write(승인형 workflow) → 이 precheck → apply → 바로 Web2·읽생기 화면 한 번씩 열어 보기.
select
  (select count(*) = 1 from supabase_migrations.schema_migrations where version = '20261128100000' and name = 'mcp_claude_write') as ok_write_migration_applied,
  exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
          where r.rolname = 'authenticator' and x.v = 'pgrst.db_pre_request=public.app_mcp_pre_request') as ok_pre_request_set_to_mcp,
  to_regprocedure('public.app_mcp_pre_request()') is not null as ok_function_present,
  coalesce(pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) like '%(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where|day_list|day_get|calls_list|call_get|recordings_list|recording_get|basket_search|basket_get|family_list|family_get)$%', false) as ok_old_list,
  (to_regprocedure('public.app_mcp_write(text,jsonb)') is not null and to_regprocedure('public.app_mcp_write_tools()') is not null) as ok_write_functions_present,
  (select string_agg(x.grantee::regrole::text, ',' order by x.grantee::regrole::text) from pg_proc p cross join lateral aclexplode(p.proacl) x
    where p.oid = to_regprocedure('public.app_mcp_pre_request()')) as execute_roles;
