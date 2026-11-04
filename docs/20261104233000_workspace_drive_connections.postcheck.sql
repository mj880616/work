-- SELECT only. 적용 뒤. 토큰 값은 읽지 않고 개수·참거짓만 본다.
select 'history (must be 1)' as check_name, count(*)::text as value from supabase_migrations.schema_migrations
  where version = '20261104233000' and name = 'workspace_drive_connections'
union all select 'rls on', relrowsecurity::text from pg_class where oid = 'public.app_drive_connections'::regclass
union all select 'policies (must be 0)', count(*)::text from pg_policy where polrelid = 'public.app_drive_connections'::regclass
union all select 'authenticated any privilege (must be false)', has_table_privilege('authenticated', 'public.app_drive_connections', 'select,insert,update,delete')::text
union all select 'anon any privilege (must be false)', has_table_privilege('anon', 'public.app_drive_connections', 'select,insert,update,delete')::text
union all select 'rows (must be 1)', count(*)::text from public.app_drive_connections
union all select 'row is operator calls workspace (must be 1)', count(*)::text from public.app_drive_connections d
  join public.app_operator_features f on f.workspace_id = d.workspace_id and f.feature = 'calls'
union all select 'same token as id=1 (must be 1)', count(*)::text from public.app_drive_connections d
  join public.public_policy_drive_config c on c.id = 1 and c.google_refresh_token = d.google_refresh_token;
