-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다.
select 'object' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_feedback', 'public.app_feedback_photos', 'public.app_profiles', 'public.app_operator_features']) n
union all select 'function', n, coalesce((select p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(n)), 'absent')
  from unnest(array['private.app_feedback_operator()', 'public.app_feedback_send(text,jsonb,jsonb)', 'public.app_feedback_list(text)', 'public.app_feedback_photo(uuid,integer)',
    'public.app_feedback_done(uuid,boolean)', 'public.app_feedback_open_count()', 'private.app_workspace_has_feature(uuid,text)']) n
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261103100000', '20261115210000')
order by 1, 2;
