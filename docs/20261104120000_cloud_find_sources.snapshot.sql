-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 바뀌는 것: app_cloud_find(text,text,integer) 정의(해시), 새 함수 app_cloud_find_in, 색인(app_cloud_items·app_documents), 정책·권한(그대로여야 함).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('app_cloud_find','app_cloud_find_in','app_cloud_list','app_cloud_trail')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_cloud_items','app_cloud_stars','app_documents')
union all select 'policy',polname,polrelid::regclass::text||':'||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'') from pg_policy
  where polrelid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),to_regclass('public.app_documents'))
union all select 'table',relname,relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class
  where oid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),to_regclass('public.app_documents'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261102160000','20261104120000')
order by 1,2;
