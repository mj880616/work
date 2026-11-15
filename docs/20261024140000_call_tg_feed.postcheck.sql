-- SELECT only. Works after apply (all 예) and after rollback (history/tables absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_feed_items') as i, to_regclass('public.app_feed_days') as d
), history as (
  select count(*) filter(where name='call_tg_feed') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261024140000'
)
select 'tables and history agree' as item,case when
  (history.n=0 and t.i is null and t.d is null) or (history.n=1 and history.named=1 and t.i is not null and t.d is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled on both',case when (select i from t) is null or (select count(*) from pg_class where oid in ((select i from t),(select d from t)) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'one authenticated owner policy each',case when (select i from t) is null or (
  (select count(*) from pg_policy where polrelid in ((select i from t),(select d from t)) and polroles=array['authenticated'::regrole]::oid[]
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%' and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=2
  and (select count(*) from pg_policy where polrelid=(select i from t))=1
  and (select count(*) from pg_policy where polrelid=(select d from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select i from t) is null or (
  not has_table_privilege('anon',(select i from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select i from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select d from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select d from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select i from t) is null or not exists(select 1 from pg_class where oid in ((select i from t),(select d from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated reads and edits only allowed columns',case when (select i from t) is null or (
  has_table_privilege('authenticated',(select i from t),'select')
  and not has_table_privilege('authenticated',(select i from t),'insert,delete,truncate')
  and has_column_privilege('authenticated',(select i from t),'pinned_at','update')
  and has_column_privilege('authenticated',(select i from t),'hidden_at','update')
  and not has_column_privilege('authenticated',(select i from t),'summary','update')
  and not has_column_privilege('authenticated',(select i from t),'workspace_id','update')
  and not has_column_privilege('authenticated',(select i from t),'suggested_project_id','update')
  and has_table_privilege('authenticated',(select d from t),'select')
  and not has_any_column_privilege('authenticated',(select d from t),'insert,update')
  and not has_table_privilege('authenticated',(select d from t),'delete,truncate')) then '예' else '아니오' end
union all select 'service_role inserts feed rows only',case when (select i from t) is null or (
  has_column_privilege('service_role',(select i from t),'summary','insert')
  and not has_column_privilege('service_role',(select i from t),'pinned_at','insert')
  and not has_column_privilege('service_role',(select i from t),'hidden_at','insert')
  and not has_column_privilege('service_role',(select i from t),'project_id','insert')
  and not has_any_column_privilege('service_role',(select i from t),'update')
  and not has_table_privilege('service_role',(select i from t),'delete,truncate')
  and not has_column_privilege('service_role',(select i from t),'raw_text','select')
  and has_column_privilege('service_role',(select i from t),'source_ref','select')) then '예' else '아니오' end
union all select 'service_role day counters only',case when (select d from t) is null or (
  has_column_privilege('service_role',(select d from t),'kept_count','update')
  and not has_column_privilege('service_role',(select d from t),'workspace_id','update')
  and not has_column_privilege('service_role',(select d from t),'day','update')
  and not has_table_privilege('service_role',(select d from t),'delete,truncate')) then '예' else '아니오' end
union all select 'guard trigger present',case when (select i from t) is null or (
  (select count(*) from pg_trigger where tgrelid=(select i from t) and not tgisinternal and tgname='app_feed_items_guard')=1
  and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_feed_item_guard()') and not prosecdef and proconfig is not null)) then '예' else '아니오' end
union all select 'one source row unique',case when (select i from t) is null or exists(select 1 from pg_constraint where conrelid=(select i from t) and conname='app_feed_items_source_ref_key' and contype='u') then '예' else '아니오' end;
