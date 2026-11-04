-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_note_folders') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_note_folders')
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('public.app_note_folder_set_color(uuid,smallint)')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_note_folders')
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'') from pg_policy p where p.polrelid=to_regclass('public.app_note_folders')
union all select 'trigger',t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regproc::text from pg_trigger t where t.tgrelid=to_regclass('public.app_note_folders') and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261028170000','20261104200000')
order by 1,2;
