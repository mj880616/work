-- SELECT only. Works after apply (all 예) and after rollback (history/table absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_record_overlaps') as s
), history as (
  select count(*) filter(where name='record_overlap_db') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261025190000'
)
select 'table and history agree' as item,case when
  (history.n=0 and t.s is null) or (history.n=1 and history.named=1 and t.s is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled',case when (select s from t) is null or exists(select 1 from pg_class where oid=(select s from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select s from t) is null or (
  (select count(*) from pg_policy where polrelid=(select s from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select s from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select s from t) is null or (
  not has_table_privilege('anon',(select s from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select s from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role has no table or column privilege',case when (select s from t) is null or (
  not has_table_privilege('service_role',(select s from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select s from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select s from t) is null or not exists(select 1 from pg_class where oid=(select s from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated cannot delete or move a pair',case when (select s from t) is null or (
  not has_table_privilege('authenticated',(select s from t),'delete')
  and not has_column_privilege('authenticated',(select s from t),'a_ref','update')
  and not has_column_privilege('authenticated',(select s from t),'b_ref','update')
  and not has_column_privilege('authenticated',(select s from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select s from t),'verdict','update')) then '예' else '아니오' end
union all select 'pair and shape rules present',case when (select s from t) is null or (
  select count(*) from pg_constraint where conrelid=(select s from t) and convalidated and conname in (
    'app_record_overlaps_pair','app_record_overlaps_order','app_record_overlaps_ref_check','app_record_overlaps_verdict_check','app_record_overlaps_decided_by_check',
    'app_record_overlaps_link_same','app_record_overlaps_keep_check','app_record_overlaps_reason_check','app_record_overlaps_hash_check','app_record_overlaps_model_check'))=10 then '예' else '아니오' end
union all select 'one enabled guard trigger',case when (select s from t) is null or (
  select count(*) from pg_trigger where tgrelid=(select s from t) and not tgisinternal and tgenabled='O' and tgname='app_record_overlaps_guard'
    and tgfoid=to_regprocedure('private.app_record_overlap_guard()'))=1 then '예' else '아니오' end
union all select 'set function invoker with fixed path and authenticated only',case when (select s from t) is null or exists(
  select 1 from pg_proc p where p.oid=to_regprocedure('public.app_record_overlap_set(uuid,jsonb)') and not p.prosecdef and p.proconfig=array['search_path=""']
    and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')) then '예' else '아니오' end
union all select 'guard function invoker and not executable by roles',case when (select s from t) is null or exists(
  select 1 from pg_proc p where p.oid=to_regprocedure('private.app_record_overlap_guard()') and not p.prosecdef and p.proconfig=array['search_path=""']
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('service_role',p.oid,'execute')) then '예' else '아니오' end;
