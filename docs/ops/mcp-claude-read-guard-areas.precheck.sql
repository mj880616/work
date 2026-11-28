-- MCP-Claude읽기 3판 L1 허용 목록 넓히기 사전 확인(SELECT만, 카탈로그만). CC가 SQL Editor 새 창 또는 조회 전용 MCP에서 실행한다.
-- 읽는 법: 모든 'ok' 칸이 true여야 apply로 간다. ok_old_list가 false면 요청 전 함수가 2판 모양이 아니다(이미 넓혔거나 다른 함수) → 멈춤.
-- 적용 순서: 20261127120000_mcp_claude_read_areas(승인형 workflow) → 이 precheck → apply → 바로 Web2·읽생기 화면 한 번씩 열어 보기.
select
  (select count(*) = 1 from supabase_migrations.schema_migrations where version = '20261127120000' and name = 'mcp_claude_read_areas') as ok_areas_migration_applied,
  exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
          where r.rolname = 'authenticator' and x.v = 'pgrst.db_pre_request=public.app_mcp_pre_request') as ok_pre_request_set_to_mcp,
  to_regprocedure('public.app_mcp_pre_request()') is not null as ok_function_present,
  coalesce(pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) like '%(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where)$%', false) as ok_old_list,
  (select count(*) = 10 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('app_mcp_day_list','app_mcp_day_get','app_mcp_calls_list','app_mcp_call_get','app_mcp_recordings_list','app_mcp_recording_get',
                       'app_mcp_basket_search','app_mcp_basket_get','app_mcp_family_list','app_mcp_family_get')) as ok_new_read_functions_present,
  (select string_agg(x.grantee::regrole::text, ',' order by x.grantee::regrole::text) from pg_proc p cross join lateral aclexplode(p.proacl) x
    where p.oid = to_regprocedure('public.app_mcp_pre_request()')) as execute_roles;
