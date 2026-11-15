-- SELECT only. pg_catalog와 migration 기록만 읽는다(새 표의 행 값·행 수를 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
-- expect: table, guard and history agree = 예
-- expect: RLS on, one authenticated owner select policy = 예
-- expect: no anon or PUBLIC privileges = 예
-- expect: authenticated read only = 예
-- expect: service_role select + column insert/update, no delete = 예
-- expect: guard: invoker, empty search_path, nobody executes, one trigger = 예
-- expect: cascade with the item and one row per item = 예
-- expect: no other DB function names the new table = 예
with t as (select to_regclass('public.app_feed_bodies') as r,to_regprocedure('private.app_feed_bodies_scope_guard()') as g),
history as (select count(*) filter(where name='feed_bodies') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261106050000')
select 'table, guard and history agree' as item,case when
  (history.n=0 and t.r is null and t.g is null)
  or (history.n=1 and history.named=1 and t.r is not null and t.g is not null)
  then '예' else '아니오' end as value
  from t,history
union all select 'RLS on, one authenticated owner select policy',case when (select r from t) is null or (
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=1
  and (select count(*) from pg_policy where polrelid=(select r from t) and polcmd='r' and polpermissive
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=1) then '예' else '아니오' end
union all select 'no anon or PUBLIC privileges',case when (select r from t) is null or (
  not exists(select 1 from pg_class where oid=(select r from t) and coalesce(relacl::text,'') ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select r from t) and attacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'authenticated read only',case when (select r from t) is null or (
  has_table_privilege('authenticated',(select r from t),'select')
  and not has_table_privilege('authenticated',(select r from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select r from t),'insert,update,references')) then '예' else '아니오' end
union all select 'service_role select + column insert/update, no delete',case when (select r from t) is null or (
  has_table_privilege('service_role',(select r from t),'select')
  and not has_table_privilege('service_role',(select r from t),'insert,update,delete,truncate,references,trigger')
  and has_column_privilege('service_role',(select r from t),'blocks','insert')
  and has_column_privilege('service_role',(select r from t),'blocks','update')
  and not has_column_privilege('service_role',(select r from t),'id','insert')
  and not has_column_privilege('service_role',(select r from t),'id','update')
  and not has_column_privilege('service_role',(select r from t),'created_at','update')) then '예' else '아니오' end
union all select 'guard: invoker, empty search_path, nobody executes, one trigger',case when (select g from t) is null or (
  (select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=(select g from t))
  and not has_function_privilege('authenticated',(select g from t),'execute')
  and not has_function_privilege('anon',(select g from t),'execute')
  and not has_function_privilege('service_role',(select g from t),'execute')
  and (select count(*) from pg_trigger where tgrelid=(select r from t) and not tgisinternal and tgfoid=(select g from t))=1
  and (select count(*) from pg_trigger where tgrelid=(select r from t) and not tgisinternal)=1) then '예' else '아니오' end
union all select 'cascade with the item and one row per item',case when (select r from t) is null or (
  (select count(*) from pg_constraint where conrelid=(select r from t) and contype='f' and confdeltype='c'
     and confrelid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'),to_regclass('public.app_workspaces')))=3
  and (select count(*) from pg_constraint where conrelid=(select r from t) and contype='u')=2) then '예' else '아니오' end
union all select 'no other DB function names the new table',case when not exists(select 1 from pg_proc
  where prosrc ~ 'app_feed_bodies' and oid<>coalesce((select g from t),0)) then '예' else '아니오' end;
