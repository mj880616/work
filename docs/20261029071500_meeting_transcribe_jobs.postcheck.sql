-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_meeting_transcribe_jobs') as j),
history as (select count(*) filter(where name='meeting_transcribe_jobs') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261029071500')
select 'table and history agree' as item,case when
  (history.n=0 and t.j is null) or (history.n=1 and history.named=1 and t.j is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner read policy for authenticated only',case when (select j from t) is null or (
  (select relrowsecurity from pg_class where oid=(select j from t))
  and (select count(*) from pg_policy where polrelid=(select j from t))=1
  and not exists(select 1 from pg_policy where polrelid=(select j from t) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'anon and PUBLIC have nothing',case when (select j from t) is null or (
  not has_table_privilege('anon',(select j from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select j from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select j from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read only',case when (select j from t) is null or (
  has_table_privilege('authenticated',(select j from t),'select')
  and not has_table_privilege('authenticated',(select j from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select j from t),'insert,update,references')) then '예' else '아니오' end
union all select 'service_role: read + listed column insert/update, no delete',case when (select j from t) is null or (
  has_table_privilege('service_role',(select j from t),'select')
  and not has_table_privilege('service_role',(select j from t),'insert,update,delete,truncate,references,trigger')
  and has_column_privilege('service_role',(select j from t),'drive_file_id','insert')
  and not has_column_privilege('service_role',(select j from t),'id','insert')
  and has_column_privilege('service_role',(select j from t),'status','update')
  and not has_column_privilege('service_role',(select j from t),'workspace_id','update')
  and not has_column_privilege('service_role',(select j from t),'drive_file_id','update')
  and not has_column_privilege('service_role',(select j from t),'created_by','update')) then '예' else '아니오' end
union all select 'one running per workspace index',case when (select j from t) is null or exists(
  select 1 from pg_index where indrelid=(select j from t) and indisunique and indpred is not null) then '예' else '아니오' end;
