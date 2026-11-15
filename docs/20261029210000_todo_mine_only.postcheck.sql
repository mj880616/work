-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 없음).
with t as (select to_regclass('public.app_todo_ask_rooms') as a,to_regclass('public.app_todo_not_mine') as n,to_regprocedure('public.app_todo_ask_filter(uuid,text)') as f),
history as (select count(*) filter(where name='todo_mine_only') as named,count(*) as c from supabase_migrations.schema_migrations where version='20261029210000')
select 'tables, function and history agree' as item,case when
  (history.c=0 and t.a is null and t.n is null and t.f is null) or (history.c=1 and history.named=1 and t.a is not null and t.n is not null and t.f is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner policy each for authenticated only',case when (select a from t) is null or (
  (select count(*) from pg_class where oid in ((select a from t),(select n from t)) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid=(select a from t))=1
  and (select count(*) from pg_policy where polrelid=(select n from t))=1
  and not exists(select 1 from pg_policy where polrelid in ((select a from t),(select n from t)) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'anon, PUBLIC and service_role have no table privilege',case when (select a from t) is null or (
  not has_table_privilege('anon',(select a from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select n from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select a from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select n from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select a from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select n from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select a from t),(select n from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read, insert fixed columns, delete, no update',case when (select a from t) is null or (
  has_table_privilege('authenticated',(select a from t),'select,delete')
  and has_table_privilege('authenticated',(select n from t),'select,delete')
  and has_column_privilege('authenticated',(select a from t),'room_key','insert')
  and has_column_privilege('authenticated',(select n from t),'summary','insert')
  and not has_any_column_privilege('authenticated',(select a from t),'update')
  and not has_any_column_privilege('authenticated',(select n from t),'update')) then '예' else '아니오' end
union all select 'filter function: definer, empty search_path, service_role only',case when (select f from t) is null or exists(
  select 1 from pg_proc p where p.oid=(select f from t) and p.prosecdef and p.proconfig=array['search_path=""']
  and coalesce(p.proacl::text,'')!~'(^|[{,])='
  and has_function_privilege('service_role',p.oid,'execute')
  and not has_function_privilege('anon',p.oid,'execute')
  and not has_function_privilege('authenticated',p.oid,'execute')) then '예' else '아니오' end;
