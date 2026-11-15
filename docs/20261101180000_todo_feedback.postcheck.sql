-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사식·표가 함께 이전 모양).
with t as (select to_regclass('public.app_todo_feedback') as f,to_regclass('public.app_todo_rules') as r),
history as (select count(*) filter(where name='todo_feedback') as named,count(*) as c from supabase_migrations.schema_migrations where version='20261101180000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) like '%done%') as done,count(*) as c from pg_constraint where conrelid=to_regclass('public.app_todo_candidates') and conname='app_todo_candidates_status_check')
select 'tables, status check and history agree' as item,case when chk.c=1 and (
  (history.c=0 and t.f is null and t.r is null and chk.done=0) or (history.c=1 and history.named=1 and t.f is not null and t.r is not null and chk.done=1)) then '예' else '아니오' end as ok
  from t,history,chk
union all select 'candidates table still has 1 policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_candidates'))=1 then '예' else '아니오' end
union all select 'RLS on, 1 owner policy each for authenticated only',case when (select f from t) is null or (
  (select count(*) from pg_class where oid in ((select f from t),(select r from t)) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid=(select f from t))=1
  and (select count(*) from pg_policy where polrelid=(select r from t))=1
  and not exists(select 1 from pg_policy where polrelid in ((select f from t),(select r from t)) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'anon, PUBLIC and service_role have no table privilege',case when (select f from t) is null or (
  not has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select r from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select f from t),(select r from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: feedback read, insert fixed columns, delete, no update',case when (select f from t) is null or (
  has_table_privilege('authenticated',(select f from t),'select,delete')
  and has_column_privilege('authenticated',(select f from t),'summary','insert')
  and not has_column_privilege('authenticated',(select f from t),'created_at','insert')
  and not has_any_column_privilege('authenticated',(select f from t),'update')) then '예' else '아니오' end
union all select 'authenticated: rules read, insert, update text/state/decided_at, delete',case when (select r from t) is null or (
  has_table_privilege('authenticated',(select r from t),'select,delete')
  and has_column_privilege('authenticated',(select r from t),'state','insert')
  and has_column_privilege('authenticated',(select r from t),'state','update')
  and not has_column_privilege('authenticated',(select r from t),'workspace_id','update')) then '예' else '아니오' end;
