-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다.
select 'object' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_update_news', 'public.app_update_news_start', 'public.app_update_news_reads', 'public.app_operator_features']) n
union all select 'function', n, coalesce((select p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(n)), 'absent')
  from unnest(array['private.app_update_news_operator()', 'public.app_update_news_list()', 'public.app_update_news_seen()', 'public.app_update_news_admin()',
    'public.app_update_news_save(uuid,text,text[],text[])', 'public.app_update_news_withdraw(uuid)', 'public.app_update_news_set_start(date)',
    'private.app_workspace_has_feature(uuid,text)']) n
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261103100000', '20261115200000')
order by 1, 2;
