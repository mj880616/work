-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_journal_memorable') as m, to_regclass('public.app_journal_memorable_runs') as r),
history as (select count(*) filter(where name='journal_memorable') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261103230000')
select 'tables and history agree' as item,case when
  (history.n=0 and t.m is null and t.r is null) or (history.n=1 and history.named=1 and t.m is not null and t.r is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner + 1 restrictive feature policy per table, authenticated only',case when (select m from t) is null or (
  (select bool_and(relrowsecurity) from pg_class where oid in ((select m from t),(select r from t)))
  and (select count(*) from pg_policy where polrelid in ((select m from t),(select r from t)))=4
  and (select count(*) from pg_policy where polrelid in ((select m from t),(select r from t)) and polroles=array[to_regrole('authenticated')::oid])=4
  and (select count(*) from pg_policy where polrelid in ((select m from t),(select r from t)) and not polpermissive and pg_get_expr(polqual,polrelid) ~ 'app_workspace_has_feature')=2
  and (select count(*) from pg_policy where polrelid in ((select m from t),(select r from t)) and polpermissive and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=2) then '예' else '아니오' end
union all select 'anon, PUBLIC and service_role have nothing',case when (select m from t) is null or (
  not has_table_privilege('anon',(select m from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select m from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select m from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select m from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select r from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select m from t),(select r from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read, insert values, update result columns only, no delete',case when (select m from t) is null or (
  has_table_privilege('authenticated',(select m from t),'select')
  and not has_table_privilege('authenticated',(select m from t),'delete,truncate,references,trigger')
  and has_column_privilege('authenticated',(select m from t),'line','insert')
  and not has_column_privilege('authenticated',(select m from t),'status','insert')
  and has_column_privilege('authenticated',(select m from t),'status','update')
  and not has_column_privilege('authenticated',(select m from t),'line','update')
  and not has_column_privilege('authenticated',(select m from t),'workspace_id','update')
  and not has_table_privilege('authenticated',(select r from t),'delete,truncate,references,trigger')
  and has_column_privilege('authenticated',(select r from t),'last_run_at','update')
  and not has_column_privilege('authenticated',(select r from t),'day','update')) then '예' else '아니오' end;
