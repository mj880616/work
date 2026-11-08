-- SELECT only. pg_catalog·migration 기록만 읽는다(새 표의 행은 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
-- expect: table, function and history agree = 예
-- expect: new table: RLS on, no policies = 예
-- expect: new table: no anon, authenticated or PUBLIC privileges = 예
-- expect: new table: service_role select, insert, update, delete only = 예
-- expect: new function: invoker, empty search_path, service_role execute only = 예
-- expect: no other DB function names the new table = 예
with t as (select to_regclass('public.app_feed_pulls') as oid),
f as (select p.oid,p.prosecdef,p.proconfig,p.prolang,p.proacl from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
  where s.nspname in ('public','private') and p.proname='app_feed_pull_take'),
history as (select count(*) filter(where name='feed_pull_now') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261108040000'),
tab as (select c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relacl from pg_catalog.pg_class c where c.oid=(select oid from t))
select 'table, function and history agree' as item,case when
  (history.n=0 and (select oid from t) is null and (select count(*) from f)=0)
  or (history.n=1 and history.named=1 and (select oid from t) is not null and (select count(*) from f)=1
      and exists(select 1 from f where f.oid=to_regprocedure('public.app_feed_pull_take(uuid,uuid,text)')))
  then '예' else '아니오' end as ok
  from history
union all select 'new table: RLS on, no policies',case when not exists(select 1 from tab where not relrowsecurity or relforcerowsecurity)
  and not exists(select 1 from pg_catalog.pg_policy where polrelid in (select oid from tab)) then '예' else '아니오' end
union all select 'new table: no anon, authenticated or PUBLIC privileges',case when
  not exists(select 1 from tab where coalesce(relacl::text,'') ~ '(^|[{,])(anon|authenticated)?=')
  and not exists(select 1 from pg_catalog.pg_attribute where attrelid in (select oid from tab) and attacl is not null)
  and not exists(select 1 from tab where has_table_privilege('anon',oid,'select,insert,update,delete,truncate,references,trigger')
    or has_table_privilege('authenticated',oid,'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'new table: service_role select, insert, update, delete only',case when
  not exists(select 1 from tab where not has_table_privilege('service_role',oid,'select')
    or not has_table_privilege('service_role',oid,'insert') or not has_table_privilege('service_role',oid,'update')
    or not has_table_privilege('service_role',oid,'delete')
    or has_table_privilege('service_role',oid,'truncate,references,trigger')) then '예' else '아니오' end
union all select 'new function: invoker, empty search_path, service_role execute only',case when
  not exists(select 1 from f where f.prosecdef or f.proconfig is distinct from array['search_path=""']
    or f.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or coalesce(f.proacl::text,'') ~ '(^|[{,])(anon|authenticated)?='
    or has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute')
    or not has_function_privilege('service_role',f.oid,'execute')) then '예' else '아니오' end
union all select 'no other DB function names the new table',case when not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
  where p.prosrc ~ 'app_feed_pulls' and not (s.nspname='public' and p.proname='app_feed_pull_take')) then '예' else '아니오' end;
