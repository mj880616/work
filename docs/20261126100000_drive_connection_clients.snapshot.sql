-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 표의 행 값은 읽지 않는다.
select 'table' as kind,c.relname::text as name,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') as definition
  from pg_class c where c.oid in (to_regclass('public.app_drive_connections'),to_regclass('public.app_drive_connection_clients'))
union all select 'column',c.relname||'.'||a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none')
  from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in (to_regclass('public.app_drive_connections'),to_regclass('public.app_drive_connection_clients')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_drive_connections'),to_regclass('public.app_drive_connection_clients'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname::text,p.polcmd::text||':'||p.polroles::text from pg_policy p where p.polrelid in (to_regclass('public.app_drive_connections'),to_regclass('public.app_drive_connection_clients'))
union all select 'object',n,coalesce(to_regclass(n)::text,'absent') from unnest(array['public.app_drive_connection_clients']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261104233000','20261126100000')
order by 1,2;
