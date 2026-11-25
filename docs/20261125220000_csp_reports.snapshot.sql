-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다.
select 'object' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_csp_reports']) n
union all select 'function', n, coalesce((select p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(n)), 'absent')
  from unnest(array['public.app_csp_report_add(jsonb)']) n
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261125220000')
order by 1, 2;
