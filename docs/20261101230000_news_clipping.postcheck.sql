-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
with t as (select to_regclass('public.app_news_items') as i,to_regclass('public.app_news_folders') as f,
  to_regclass('public.app_news_keywords') as k,to_regclass('public.app_news_days') as d,
  to_regprocedure('public.app_news_prune(timestamptz,integer)') as p,
  to_regprocedure('private.app_news_folder_tree_guard()') as g,to_regprocedure('private.app_news_folder_lift()') as l),
history as (select count(*) filter(where name='news_clipping') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261101230000')
select 'tables, functions and history agree' as item,case when
  (history.n=0 and t.i is null and t.f is null and t.k is null and t.d is null and t.p is null and t.g is null and t.l is null)
  or (history.n=1 and history.named=1 and t.i is not null and t.f is not null and t.k is not null and t.d is not null
      and t.p is not null and t.g is not null and t.l is not null)
  then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on and one authenticated owner policy per table',case when (select i from t) is null or (
  (select count(*) from pg_class where oid in ((select i from t),(select f from t),(select k from t),(select d from t)) and relrowsecurity)=4
  and (select count(*) from pg_policy where polrelid in ((select i from t),(select f from t),(select k from t),(select d from t))
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=4
  and (select count(*) from pg_policy where polrelid in ((select i from t),(select f from t),(select k from t),(select d from t)))=4) then '예' else '아니오' end
union all select 'anon has nothing and no PUBLIC grant',case when (select i from t) is null or (not exists(
  select 1 from unnest(array[(select i from t),(select f from t),(select k from t),(select d from t)]) r(r)
  where has_table_privilege('anon',r.r,'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon',r.r,'select,insert,update,references'))
  and not exists(select 1 from pg_class where oid in ((select i from t),(select f from t),(select k from t),(select d from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated changes only star folder hide on items',case when (select i from t) is null or (
  has_table_privilege('authenticated',(select i from t),'select')
  and not has_table_privilege('authenticated',(select i from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select i from t),'insert')
  and has_column_privilege('authenticated',(select i from t),'starred_at','update')
  and has_column_privilege('authenticated',(select i from t),'folder_id','update')
  and has_column_privilege('authenticated',(select i from t),'hidden_at','update')
  and not has_column_privilege('authenticated',(select i from t),'body','update')
  and not has_column_privilege('authenticated',(select i from t),'body_ko','update')
  and not has_column_privilege('authenticated',(select i from t),'title_ko','update')
  and not has_column_privilege('authenticated',(select i from t),'summary','update')
  and not has_column_privilege('authenticated',(select i from t),'workspace_id','update')) then '예' else '아니오' end
union all select 'authenticated reads usage only',case when (select d from t) is null or (
  has_table_privilege('authenticated',(select d from t),'select')
  and not has_table_privilege('authenticated',(select d from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select d from t),'insert,update')) then '예' else '아니오' end
union all select 'service_role: items write, keywords read, usage write, folders none',case when (select i from t) is null or (
  has_table_privilege('service_role',(select i from t),'select,insert,update,delete')
  and has_table_privilege('service_role',(select k from t),'select')
  and not has_table_privilege('service_role',(select k from t),'insert,update,delete')
  and has_table_privilege('service_role',(select d from t),'select,insert,update')
  and not has_table_privilege('service_role',(select d from t),'delete')
  and not has_table_privilege('service_role',(select f from t),'select,insert,update,delete')
  and not exists(select 1 from unnest(array[(select i from t),(select f from t),(select k from t),(select d from t)]) r(r)
    where has_table_privilege('service_role',r.r,'truncate,references,trigger'))) then '예' else '아니오' end
union all select 'prune function definer, fixed path, service_role only',case when (select p from t) is null or (
  (select prosecdef from pg_proc where oid=(select p from t))
  and (select proconfig from pg_proc where oid=(select p from t))=array['search_path=""']
  and has_function_privilege('service_role',(select p from t),'execute')
  and not has_function_privilege('authenticated',(select p from t),'execute')
  and not has_function_privilege('anon',(select p from t),'execute')
  and not exists(select 1 from pg_proc where oid=(select p from t) and proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'folder triggers invoker with fixed path',case when (select f from t) is null or (
  (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=2
  and exists(select 1 from pg_proc where oid=(select g from t) and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%if v_above >= 100 then%')
  and exists(select 1 from pg_proc where oid=(select l from t) and not prosecdef and proconfig=array['search_path=""'])) then '예' else '아니오' end;
