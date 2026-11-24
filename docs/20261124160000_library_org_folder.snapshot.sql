-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
select 'column' as kind,c.relname||'.'||a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('public.app_library_folder_set_org(uuid,uuid)')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'') from pg_policy p where p.polrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regproc::text from pg_trigger t where t.tgrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles')) and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261111181000','20261124100000','20261124160000')
union all select 'index',c.relname::text,pg_get_indexdef(c.oid) from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
order by 1,2;
