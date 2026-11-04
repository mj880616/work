-- SELECT only. 20261104233000_workspace_drive_connections 적용 전. 값(토큰·id)은 읽지 않고 개수·참거짓만 본다.
select 'already applied' as item, count(*)::text as value from supabase_migrations.schema_migrations where version = '20261104233000'
union all select 'operator_features applied', count(*)::text from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features'
union all select 'app_drive_connections exists', (to_regclass('public.app_drive_connections') is not null)::text
union all select 'calls workspaces (must be 1)', count(*)::text from public.app_operator_features where feature = 'calls'
union all select 'id=1 refresh token present (must be 1)', count(*)::text from public.public_policy_drive_config
  where id = 1 and coalesce(char_length(google_refresh_token), 0) between 8 and 4096
union all select 'calls workspace = files workspace', (
  select count(*) from public.app_operator_features c join public.app_operator_features f
    on f.workspace_id = c.workspace_id and f.feature = 'files' where c.feature = 'calls')::text
union all select 'owner rows total (참고: 가입 닫힘 확인)', count(*)::text from public.app_workspace_members where role = 'owner';
