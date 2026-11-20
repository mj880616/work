-- SELECT only. 20261120090000_mcp_claude_read 적용 뒤. 카탈로그·migration 기록·새 표 줄 수만 읽는다(행 값 없음).
-- 예/아니오 항목은 모두 예, 해시는 precheck의 같은 이름 항목과 같은 값이어야 한다(기존 owner 경계·원장 검색·잠금 목록 함수 무변경).
-- expect: history row present = 예
-- expect: two tables RLS on owner policies only no anon or service_role = 예
-- expect: settings column update only enabled revoked_before updated_at = 예
-- expect: five private helpers empty path authenticated only = 예
-- expect: seven public read functions invoker empty path authenticated only = 예
-- expect: new tables empty = 예
-- expect: authenticator pre-request unset = 예
-- expect: existing boundary hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261120090000' and name='mcp_claude_read')=1 then '예' else '아니오' end as ok
union all select 'two tables RLS on owner policies only no anon or service_role',case when (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'app\_mcp\_%')=2
  and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'app\_mcp\_%' and (
    not c.relrowsecurity
    or has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger')
    or has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger')
    or has_any_column_privilege('anon',c.oid,'select,insert,update,references')
    or has_any_column_privilege('service_role',c.oid,'select,insert,update,references')
    or has_table_privilege('authenticated',c.oid,'insert,update,delete,truncate,references,trigger')
    or not has_table_privilege('authenticated',c.oid,'select')
    or coalesce(c.relacl::text,'') ~ '(^|[{,])(anon|service_role)?='))
  and (select count(*) from pg_policy p where p.polrelid in (to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log')))=3
  and not exists(select 1 from pg_policy p where p.polrelid in (to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'))
    and (p.polroles<>array['authenticated'::regrole]::oid[] or not p.polpermissive or coalesce(pg_get_expr(p.polqual,p.polrelid),'') not like '%app_is_workspace_owner(workspace_id)%'))
  then '예' else '아니오' end
union all select 'settings column update only enabled revoked_before updated_at',case when has_column_privilege('authenticated','public.app_mcp_settings','enabled','update')
  and has_column_privilege('authenticated','public.app_mcp_settings','revoked_before','update') and has_column_privilege('authenticated','public.app_mcp_settings','updated_at','update')
  and not has_column_privilege('authenticated','public.app_mcp_settings','allowed_client_id','update') and not has_column_privilege('authenticated','public.app_mcp_settings','workspace_id','update')
  and not has_any_column_privilege('authenticated','public.app_mcp_settings','insert') and not has_any_column_privilege('authenticated','public.app_mcp_read_log','insert,update')
  then '예' else '아니오' end
union all select 'five private helpers empty path authenticated only',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'app\_mcp\_%')=5
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'app\_mcp\_%'
    and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0)
    and p.prosecdef=(p.proname in ('app_mcp_gate','app_mcp_gate_done','app_mcp_note_locks')))=5 then '예' else '아니오' end
union all select 'seven public read functions invoker empty path authenticated only',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app\_mcp\_%')=7
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app\_mcp\_%'
    and not p.prosecdef and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0))=7 then '예' else '아니오' end
union all select 'new tables empty',case when not exists(select 1 from public.app_mcp_settings) and not exists(select 1 from public.app_mcp_read_log) then '예' else '아니오' end
union all select 'authenticator pre-request unset',case when not exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) x(v) where r.rolname='authenticator' and x.v like 'pgrst.db\_pre\_request=%') then '예' else '아니오' end
union all select 'existing boundary hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text) from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('public.app_ledger_search(text,text[],uuid,uuid,date,date,text,text,boolean,integer)'),to_regprocedure('private.app_lock_note_folder_list(uuid)'))),'')||coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'),to_regclass('public.app_note_folder_locks'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'))),''));
