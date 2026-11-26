-- SELECT only. Save before apply. System catalogs and the migration history only (no profile row values; the rows themselves are kept
-- by the apply backup in ops_backup and, for the three emptied columns, by public.app_cleanup_s71_40_profiles).
select 'column' as kind, a.attname as name, format_type(a.atttypid, a.atttypmod) || ':required=' || a.attnotnull::text || ':default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'none') || ':acl=' || coalesce(a.attacl::text, 'none') as definition
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attrelid = to_regclass('public.app_profiles') and a.attnum > 0 and not a.attisdropped
union all select 'constraint', conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.app_profiles')
union all select 'policy', polname, polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
  from pg_policy where polrelid = to_regclass('public.app_profiles')
union all select 'trigger', tgname, tgenabled::text || ':' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = to_regclass('public.app_profiles') and not tgisinternal
union all select 'owner RLS grants', relname, relowner::text || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text || ':' || coalesce(relacl::text, 'none')
  from pg_class where oid = to_regclass('public.app_profiles')
union all select 'backup table', coalesce(to_regclass('public.app_cleanup_s71_40_profiles')::text, 'absent'), ''
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261115223000', '20261126202000')
order by 1, 2;
