-- SELECT only. Save before apply. System catalogs and the migration history only (no organization row values; the rows themselves are kept
-- by the apply backup in ops_backup and, for the moved organizations, by public.app_cleanup_s71_40_orgs).
-- 'fk' rows list every foreign key that points at app_suborganizations (table.column and ON DELETE action): if the migration stops on the
-- FK list guard, add the missing tables from these rows in a new PR.
select 'fk' as kind, c.relnamespace::regnamespace::text || '.' || c.relname || '.' || a.attname as name,
       k.conname || ':ondelete=' || k.confdeltype::text || ':' || pg_get_constraintdef(k.oid) as definition
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
 where k.contype = 'f' and k.confrelid = to_regclass('public.app_suborganizations')
union all select 'column', a.attname, format_type(a.atttypid, a.atttypmod) || ':required=' || a.attnotnull::text || ':default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'none') || ':acl=' || coalesce(a.attacl::text, 'none')
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attrelid = to_regclass('public.app_suborganizations') and a.attnum > 0 and not a.attisdropped
union all select 'constraint', conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.app_suborganizations')
union all select 'policy', polname, polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
  from pg_policy where polrelid = to_regclass('public.app_suborganizations')
union all select 'trigger', tgname, tgenabled::text || ':' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = to_regclass('public.app_suborganizations') and not tgisinternal
union all select 'owner RLS grants', relname, relowner::text || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text || ':' || coalesce(relacl::text, 'none')
  from pg_class where oid = to_regclass('public.app_suborganizations')
union all select 'trash function', p.oid::regprocedure::text, p.prosecdef::text || ':' || coalesce(p.proconfig::text, 'none') || ':' || coalesce(p.proacl::text, 'none') || ':' || md5(p.prosrc)
  from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'app_trash_org_before_delete'
union all select 'backup table', coalesce(to_regclass('public.app_cleanup_s71_40_orgs')::text, 'absent'), ''
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261025100000', '20261126201000')
order by 1, 2;
