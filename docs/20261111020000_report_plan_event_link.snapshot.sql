-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_meetings and app_calendar_report_plans (columns, constraints, indexes, policies, triggers, grants),
-- the app_workspaces table grants and policies, and this migration record.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname::text,pg_get_constraintdef(oid) from pg_constraint
  where conrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans'))
union all select 'index',indexrelid::regclass::text,pg_get_indexdef(indexrelid) from pg_index
  where indrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans'))
union all select 'table',c.relname::text,c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c
  where c.oid in (to_regclass('public.app_workspaces'),to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p
  where p.polrelid in (to_regclass('public.app_workspaces'),to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t
  where t.tgrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_calendar_report_plans')) and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261111020000'
order by 1,2;
