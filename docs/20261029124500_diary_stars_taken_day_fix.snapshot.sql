-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows; the star rows themselves are kept by the apply backup in ops_backup).
-- Schema snapshot of app_diary_stars (columns, constraints, indexes, policies, triggers, grants) and the owner check function its policy relies on.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_diary_stars') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_diary_stars')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='app_diary_stars'
union all select 'policy',polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_diary_stars')
union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid=to_regclass('public.app_diary_stars') and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_diary_stars')
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_workspace_owner'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261028010000','20261029124500')
order by 1,2;
