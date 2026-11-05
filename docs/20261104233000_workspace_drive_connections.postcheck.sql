-- SELECT only. 적용 뒤. 토큰 값은 읽지 않고 개수·참거짓만 본다.
-- expect: history recorded = 예
-- expect: rls on = 예
-- expect: no policies = 예
-- expect: no authenticated privilege = 예
-- expect: no anon privilege = 예
-- expect: one row = 예
-- expect: row is operator calls workspace = 예
-- expect: same token as id=1 = 예
select 'history recorded' as item, case when (select count(*) from supabase_migrations.schema_migrations where version='20261104233000' and name='workspace_drive_connections')=1 then '예' else '아니오' end as value
union all select 'rls on', case when exists(select 1 from pg_class where oid=to_regclass('public.app_drive_connections') and relrowsecurity) then '예' else '아니오' end
union all select 'no policies', case when not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_drive_connections')) then '예' else '아니오' end
union all select 'no authenticated privilege', case when not has_table_privilege('authenticated','public.app_drive_connections','select,insert,update,delete') then '예' else '아니오' end
union all select 'no anon privilege', case when not has_table_privilege('anon','public.app_drive_connections','select,insert,update,delete') then '예' else '아니오' end
union all select 'one row', case when (select count(*) from public.app_drive_connections)=1 then '예' else '아니오' end
union all select 'row is operator calls workspace', case when (select count(*) from public.app_drive_connections d join public.app_operator_features f on f.workspace_id=d.workspace_id and f.feature='calls')=1 then '예' else '아니오' end
union all select 'same token as id=1', case when (select count(*) from public.app_drive_connections d join public.public_policy_drive_config c on c.id=1 and c.google_refresh_token=d.google_refresh_token)=1 then '예' else '아니오' end;
