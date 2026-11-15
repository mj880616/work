-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks'))
union all select 'index',indexrelid::regclass::text,pg_get_indexdef(indexrelid) from pg_index where indrelid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks'))
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p where p.polrelid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regproc::text from pg_trigger t where t.tgrelid in (to_regclass('public.app_journal_memorable'),to_regclass('public.app_journal_memorable_picks')) and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261103230000','20261109020000')
order by 1,2;
