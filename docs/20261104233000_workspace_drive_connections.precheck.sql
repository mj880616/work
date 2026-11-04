-- SELECT only. 20261104233000_workspace_drive_connections 적용 전. 값(토큰·id)은 읽지 않고 개수·참거짓만 본다.
-- expect: new migration absent = 예
-- expect: operator_features applied = 예
-- expect: app_drive_connections absent = 예
-- expect: calls workspace single = 예
-- expect: id=1 refresh token present = 예
-- expect: calls workspace = files workspace = 예
-- expect: owner rows single (가입 닫힘) = 예
select 'new migration absent' as item, case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104233000') then '예' else '아니오' end as value
union all select 'operator_features applied', case when (select count(*) from supabase_migrations.schema_migrations where version='20261029090000' and name='operator_features')=1 then '예' else '아니오' end
union all select 'app_drive_connections absent', case when to_regclass('public.app_drive_connections') is null then '예' else '아니오' end
union all select 'calls workspace single', case when (select count(*) from public.app_operator_features where feature='calls')=1 then '예' else '아니오' end
union all select 'id=1 refresh token present', case when (select count(*) from public.public_policy_drive_config where id=1 and coalesce(char_length(google_refresh_token),0) between 8 and 4096)=1 then '예' else '아니오' end
union all select 'calls workspace = files workspace', case when (select count(*) from public.app_operator_features c join public.app_operator_features f on f.workspace_id=c.workspace_id and f.feature='files' where c.feature='calls')=1 then '예' else '아니오' end
union all select 'owner rows single (가입 닫힘)', case when (select count(*) from public.app_workspace_members where role='owner')=1 then '예' else '아니오' end;
