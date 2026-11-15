-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_meetings and app_record_links (columns incl. location, constraints incl. the real FK names to app_meetings,
-- indexes, policies, triggers, owner·RLS·grants) and of the new function name (absent before apply).
select 'column' as kind,c.relname||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||k.conname,pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid
  where k.conrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links'))
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_meetings','app_record_links')
union all select 'policy',c.relname||'.'||p.polname,p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links'))
union all select 'trigger',c.relname||'.'||t.tgname,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and not t.tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links'))
union all select 'function',p.proname,pg_get_function_identity_arguments(p.oid)||':definer='||p.prosecdef::text||':acl='||coalesce(p.proacl::text,'none')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_meeting_set_links'
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261023023500'
order by 1,2;
