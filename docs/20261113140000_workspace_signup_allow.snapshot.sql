-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다. 긴 정의는 md5·길이로만(메일이 든 정의 본문은 내보내지 않는다).
select 'object' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_workspace_signup_allow', 'public.app_workspace_signup', 'public.app_workspace_members']) n
union all select 'function', n, coalesce((select p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || length(pg_get_functiondef(p.oid))::text || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(n)), 'absent')
  from unnest(array['public.app_workspace_start()', 'public.app_workspace_start_status()', 'private.app_enforce_workspace_member_role()']) n
union all select 'trigger', c.relname::text || '.' || t.tgname::text, t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgrelid = to_regclass('public.app_workspace_members') and not t.tgisinternal
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261105183000', '20261113140000')
order by 1, 2;
