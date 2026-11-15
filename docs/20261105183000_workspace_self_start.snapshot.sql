-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다. 긴 정의는 md5·길이로만.
select 'object' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_workspace_signup', 'public.app_workspaces', 'public.app_workspace_members', 'public.app_profiles']) n
union all select 'function', n, coalesce((select p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(n)), 'absent')
  from unnest(array['public.app_workspace_start()', 'public.app_workspace_start_status()']) n
union all select 'table ACL', c.relname::text, c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, 'none')
  from pg_class c where c.oid in (to_regclass('public.app_workspace_signup'), to_regclass('public.app_workspaces'), to_regclass('public.app_workspace_members'), to_regclass('public.app_profiles'))
union all select 'policy count', c.relname::text, (select count(*) from pg_policy p where p.polrelid = c.oid)::text
  from pg_class c where c.oid in (to_regclass('public.app_workspace_signup'), to_regclass('public.app_workspaces'), to_regclass('public.app_workspace_members'), to_regclass('public.app_profiles'))
union all select 'trigger', c.relname::text || '.' || t.tgname::text, t.tgenabled::text || ':' || length(pg_get_triggerdef(t.oid))::text || ':' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgrelid in (to_regclass('public.app_workspaces'), to_regclass('public.app_workspace_members'), to_regclass('public.app_profiles')) and not t.tgisinternal
union all select 'history', version, name from supabase_migrations.schema_migrations where version = '20261105183000'
order by 1, 2;
