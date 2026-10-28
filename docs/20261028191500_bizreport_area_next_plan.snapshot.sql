-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_meetings (columns, constraints, indexes, policies, triggers, grants) and app_spaces' incoming foreign keys.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_meetings')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'policy',polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_meetings')
union all select 'FK into projects',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint where contype='f' and confrelid=to_regclass('public.app_spaces')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261028191500'
order by 1,2;
