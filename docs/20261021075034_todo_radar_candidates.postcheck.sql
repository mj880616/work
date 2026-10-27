-- SELECT only. Works after apply (all 예) and after rollback (history/tables absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_todo_candidates') as cand, to_regclass('public.app_todo_radar_state') as state
), history as (
  select count(*) filter(where name='todo_radar_candidates') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261021075034'
)
select 'tables and history agree' as item,case when
  (history.n=0 and t.cand is null and t.state is null) or (history.n=1 and history.named=1 and t.cand is not null and t.state is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled on both',case when (select cand from t) is null or not exists(select 1 from pg_class where oid in((select cand from t),(select state from t)) and not relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy each',case when (select cand from t) is null or (
  (select count(*) from pg_policy where polrelid=(select cand from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select state from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid in((select cand from t),(select state from t)))=2) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select cand from t) is null or (
  not has_table_privilege('anon',(select cand from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select state from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select cand from t),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select state from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role has no table or column privilege',case when (select cand from t) is null or (
  not has_table_privilege('service_role',(select cand from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select state from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select cand from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select state from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select cand from t) is null or not exists(select 1 from pg_class where oid in((select cand from t),(select state from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated cannot set status on insert or change summary/source',case when (select cand from t) is null or (
  not has_column_privilege('authenticated',(select cand from t),'status','insert')
  and not has_column_privilege('authenticated',(select cand from t),'task_id','insert')
  and not has_column_privilege('authenticated',(select cand from t),'summary','update')
  and not has_column_privilege('authenticated',(select cand from t),'source_id','update')
  and not has_column_privilege('authenticated',(select cand from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select cand from t),'status','update')) then '예' else '아니오' end
union all select 'candidates hold no full text column',case when (select cand from t) is null or not exists(select 1 from pg_attribute where attrelid=(select cand from t) and attname in('raw_text','text','body','transcript_text') and not attisdropped) then '예' else '아니오' end;
