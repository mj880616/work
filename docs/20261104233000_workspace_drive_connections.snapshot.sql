-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
select 'table' as kind, n as name, coalesce(to_regclass(n)::text, 'absent') as definition
  from unnest(array['public.app_drive_connections', 'public.public_policy_drive_config']) n
union all select 'table ACL', c.relname::text, c.relrowsecurity::text || ':' || coalesce(c.relacl::text, 'none')
  from pg_class c where c.oid in (to_regclass('public.public_policy_drive_config'), to_regclass('public.app_drive_connections'))
union all select 'policy count', c.relname::text, (select count(*) from pg_policy p where p.polrelid = c.oid)::text
  from pg_class c where c.oid in (to_regclass('public.public_policy_drive_config'), to_regclass('public.app_drive_connections'))
union all select 'history', version, name from supabase_migrations.schema_migrations where version = '20261104233000'
order by 1, 2;
