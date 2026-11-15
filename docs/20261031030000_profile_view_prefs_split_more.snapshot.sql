-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_profiles (columns, constraints, indexes, policies, triggers, grants) and the owner check function it relies on.
-- 화면 기억 검사(app_profiles_view_prefs_check)는 정의가 8천 자를 넘어(snapshot 한 값 상한 8192자) 해시·길이로 기록한다. 원문은 rollback 파일에 있다.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_profiles') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,case when conname='app_profiles_view_prefs_check' then 'md5:'||md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) else pg_get_constraintdef(oid) end from pg_constraint where conrelid=to_regclass('public.app_profiles')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'policy',polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_profiles')
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_owner_profile'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261031010000','20261031030000')
order by 1,2;
