-- SELECT only. User saves the schema snapshot of app_spaces (and the trash RPC names) before apply; no row values.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_spaces') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_spaces')
union all select 'foreign key in',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint where contype='f' and confrelid=to_regclass('public.app_spaces')
union all select 'index',indexrelid::regclass::text,pg_get_indexdef(indexrelid) from pg_index where indrelid=to_regclass('public.app_spaces')
union all select 'policy',polname,polcmd::text||':'||polpermissive::text||':'||polroles::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_spaces')
union all select 'trigger',tgname,tgenabled::text||':'||tgtype::text||':'||tgfoid::regprocedure::text from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_spaces')
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(array_to_string(p.proconfig,','),'')||':'||coalesce(p.proacl::text,'default') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in ('app_trash_space_before_delete','app_trash_list','app_trash_restore','app_trash_purge','app_unlink_retained_project_records','app_is_workspace_owner')
union all select 'migration',version,name from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r
order by 1,2;
