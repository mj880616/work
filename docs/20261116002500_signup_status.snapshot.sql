-- SELECT only. Save before apply. 카탈로그와 migration 기록만 읽는다(표 줄 값 없음). 함수 본문은 해시로 기록한다.
select 'function' as kind,n as name,coalesce((select p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid=to_regprocedure(n)),'absent') as definition
  from unnest(array['public.app_signup_list()','private.app_signup_people()','public.app_signup_since(timestamp with time zone)','private.app_workspace_has_feature(uuid,text)']) n
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_profiles'),to_regclass('public.app_operator_features'))
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')) from pg_policy p where p.polrelid=to_regclass('public.app_profiles')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261115223000','20261115234500','20261116002500')
order by 1,2;
