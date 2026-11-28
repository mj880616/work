-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- MCP 함수 정의·권한, 쓰기 기록 표 칸·검사·권한·정책, 노트 표 권한·정책·트리거, 이번 기록 유무를 남긴다(되돌린 뒤 같은지 대조).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_mcp\_%'
union all select 'log column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'')
  from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_write_log') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conrelid::regclass::text||'.'||c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid in (to_regclass('public.app_mcp_write_log'),to_regclass('public.app_mcp_write_before'),to_regclass('public.app_mcp_settings'))
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid in (to_regclass('public.app_notes'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_write_log'),to_regclass('public.app_mcp_write_before'),to_regclass('public.app_operator_features'),to_regclass('public.app_workspace_members'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid in (to_regclass('public.app_notes'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_write_log'),to_regclass('public.app_mcp_write_before'),to_regclass('public.app_operator_features'),to_regclass('public.app_workspace_members'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regprocedure::text
  from pg_trigger t where not t.tgisinternal and t.tgrelid in (to_regclass('public.app_notes'),to_regclass('public.app_mcp_write_log'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261128120000'
order by 1,2;
