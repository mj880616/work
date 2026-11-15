-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_cloud_jobs') as j,to_regclass('public.app_cloud_job_uploads') as u),
history as (select count(*) filter(where name='cloud_jobs') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261104162800')
select 'tables and history agree' as item,case when
  (history.n=0 and t.j is null and t.u is null) or (history.n=1 and history.named=1 and t.j is not null and t.u is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'jobs: RLS on, 1 owner+files read policy for authenticated only',case when (select j from t) is null or (
  (select relrowsecurity from pg_class where oid=(select j from t))
  and (select count(*) from pg_policy where polrelid=(select j from t))=1
  and not exists(select 1 from pg_policy where polrelid=(select j from t) and (polcmd<>'r' or not (polroles=array[to_regrole('authenticated')::oid])))) then '예' else '아니오' end
union all select 'uploads: RLS on, no policy',case when (select u from t) is null or (
  (select relrowsecurity from pg_class where oid=(select u from t))
  and not exists(select 1 from pg_policy where polrelid=(select u from t))) then '예' else '아니오' end
union all select 'anon and PUBLIC have nothing',case when (select j from t) is null or (
  not has_table_privilege('anon',(select j from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select j from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select u from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select u from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select j from t),(select u from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: jobs read only, uploads nothing',case when (select j from t) is null or (
  has_table_privilege('authenticated',(select j from t),'select')
  and not has_table_privilege('authenticated',(select j from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select j from t),'insert,update,references')
  and not has_table_privilege('authenticated',(select u from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select u from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role: jobs read + listed columns, no delete',case when (select j from t) is null or (
  has_table_privilege('service_role',(select j from t),'select')
  and not has_table_privilege('service_role',(select j from t),'insert,update,delete,truncate,references,trigger')
  and has_column_privilege('service_role',(select j from t),'src_id','insert')
  and not has_column_privilege('service_role',(select j from t),'id','insert')
  and has_column_privilege('service_role',(select j from t),'sent_bytes','update')
  and not has_column_privilege('service_role',(select j from t),'workspace_id','update')
  and not has_column_privilege('service_role',(select j from t),'created_by','update')
  and not has_column_privilege('service_role',(select j from t),'src_id','update')) then '예' else '아니오' end
union all select 'existing cloud items keep 1 policy',case when
  (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_items'))=1 then '예' else '아니오' end;
