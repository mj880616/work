-- SELECT only. Save before apply. System catalogs and the migration history only (no feedback rows).
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a where a.attrelid=to_regclass('public.app_todo_feedback') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_todo_feedback')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='app_todo_feedback'
union all select 'policy',polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_todo_feedback')
union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid=to_regclass('public.app_todo_feedback') and not tgisinternal
union all select 'table grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_todo_feedback')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261101180000','20261102030000','20261103210000')
order by 1,2;
