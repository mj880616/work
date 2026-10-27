-- SELECT only. Works after apply (all 예) and after rollback (history/column absent → first row 예, the rest 예 by absence).
with t as (select to_regclass('public.app_todo_candidates') as cand),
col as (select count(*) as n from pg_attribute,t where attrelid=t.cand and attname='task_due' and atttypid='date'::regtype and not attisdropped and not attnotnull),
history as (select count(*) filter(where name='todo_candidates_task_due') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261027060000')
select 'column and history agree' as item,case when (history.n=0 and col.n=0) or (history.n=1 and history.named=1 and col.n=1) then '예' else '아니오' end as ok from col,history
union all select 'only tasked rows may hold task_due',case when col.n=0 or ((select count(*) from pg_constraint where conrelid=(select cand from t) and conname='app_todo_candidates_task_due_check' and pg_get_constraintdef(oid) like '%task_due IS NULL%tasked%')=1
  ) then '예' else '아니오' end from col
union all select 'authenticated may update but not insert task_due',case when col.n=0 or (has_column_privilege('authenticated',(select cand from t),'task_due','update') and not has_column_privilege('authenticated',(select cand from t),'task_due','insert')) then '예' else '아니오' end from col
union all select 'anon and service_role have no privilege',case when (select cand from t) is null or (
  not has_table_privilege('anon',(select cand from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select cand from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select cand from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select cand from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select cand from t) is null or not exists(select 1 from pg_class where oid=(select cand from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'still one owner policy and summary not updatable',case when (select cand from t) is null or (
  (select count(*) from pg_policy where polrelid=(select cand from t))=1
  and (select count(*) from pg_policy where polrelid=(select cand from t) and polname='todo_candidates_owner_all' and polroles=array['authenticated'::regrole]::oid[])=1
  and not has_column_privilege('authenticated',(select cand from t),'summary','update')) then '예' else '아니오' end;
