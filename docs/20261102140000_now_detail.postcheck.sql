-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
with t as (select to_regclass('public.app_now_details') as d,to_regclass('public.app_outside_marks') as m,
  to_regclass('public.app_now_signals') as s,to_regclass('public.app_now_interests') as i,
  to_regprocedure('private.app_now_item_scope_guard()') as g),
history as (select count(*) filter(where name='now_detail') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261102140000')
select 'tables, function and history agree' as item,case when
  (history.n=0 and t.d is null and t.m is null and t.s is null and t.i is null and t.g is null)
  or (history.n=1 and history.named=1 and t.d is not null and t.m is not null and t.s is not null and t.i is not null and t.g is not null)
  then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on and one authenticated owner policy per table',case when (select d from t) is null or (
  (select count(*) from pg_class where oid in ((select d from t),(select m from t),(select s from t),(select i from t)) and relrowsecurity)=4
  and (select count(*) from pg_policy where polrelid in ((select d from t),(select m from t),(select s from t),(select i from t))
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=4
  and (select count(*) from pg_policy where polrelid in ((select d from t),(select m from t),(select s from t),(select i from t)))=4) then '예' else '아니오' end
union all select 'anon has nothing and no PUBLIC grant',case when (select d from t) is null or (not exists(
  select 1 from unnest(array[(select d from t),(select m from t),(select s from t),(select i from t)]) r(r)
  where has_table_privilege('anon',r.r,'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon',r.r,'select,insert,update,references'))
  and not exists(select 1 from pg_class where oid in ((select d from t),(select m from t),(select s from t),(select i from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated reads details only',case when (select d from t) is null or (
  has_table_privilege('authenticated',(select d from t),'select')
  and not has_table_privilege('authenticated',(select d from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select d from t),'insert,update')) then '예' else '아니오' end
union all select 'authenticated adds signals only (no update, delete, time)',case when (select s from t) is null or (
  has_table_privilege('authenticated',(select s from t),'select')
  and has_column_privilege('authenticated',(select s from t),'action','insert')
  and not has_column_privilege('authenticated',(select s from t),'created_at','insert')
  and not has_any_column_privilege('authenticated',(select s from t),'update')
  and not has_table_privilege('authenticated',(select s from t),'delete')) then '예' else '아니오' end
union all select 'authenticated marks and interests columns as planned',case when (select m from t) is null or (
  has_column_privilege('authenticated',(select m from t),'starred_at','insert,update')
  and has_column_privilege('authenticated',(select m from t),'archived_at','insert,update')
  and has_column_privilege('authenticated',(select m from t),'dismissed_at','insert,update')
  and not has_column_privilege('authenticated',(select m from t),'post_id','update')
  and not has_column_privilege('authenticated',(select m from t),'workspace_id','update')
  and has_table_privilege('authenticated',(select m from t),'delete')
  and has_column_privilege('authenticated',(select i from t),'state','insert,update')
  and not has_column_privilege('authenticated',(select i from t),'origin','insert')
  and not has_column_privilege('authenticated',(select i from t),'origin','update')
  and not has_column_privilege('authenticated',(select i from t),'reason','update')
  and not has_column_privilege('authenticated',(select i from t),'workspace_id','update')
  and has_table_privilege('authenticated',(select i from t),'delete')) then '예' else '아니오' end
union all select 'service_role: details write, marks read, signals read and delete, interests write',case when (select d from t) is null or (
  has_table_privilege('service_role',(select d from t),'select,insert,update,delete')
  and has_table_privilege('service_role',(select m from t),'select')
  and not has_table_privilege('service_role',(select m from t),'insert,update,delete')
  and has_table_privilege('service_role',(select s from t),'select,delete')
  and not has_table_privilege('service_role',(select s from t),'insert,update')
  and has_table_privilege('service_role',(select i from t),'select,insert,update,delete')
  and not exists(select 1 from unnest(array[(select d from t),(select m from t),(select s from t),(select i from t)]) r(r)
    where has_table_privilege('service_role',r.r,'truncate,references,trigger'))) then '예' else '아니오' end
union all select 'scope guard invoker with fixed path on three tables',case when (select g from t) is null or (
  (select count(*) from pg_trigger where tgrelid in ((select d from t),(select m from t),(select s from t)) and not tgisinternal and tgfoid=(select g from t))=3
  and exists(select 1 from pg_proc where oid=(select g from t) and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%NOW_ITEM_SCOPE%')
  and not has_function_privilege('anon',(select g from t),'execute')
  and not exists(select 1 from pg_proc where oid=(select g from t) and proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end;
