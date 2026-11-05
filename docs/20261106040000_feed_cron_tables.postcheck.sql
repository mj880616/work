-- SELECT only. pg_catalog·migration 기록만 읽는다(새 표의 행은 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
-- expect: tables, functions and history agree = 예
-- expect: new tables: RLS on, no policies = 예
-- expect: new tables: no anon, authenticated or PUBLIC privileges = 예
-- expect: new tables: service_role select only = 예
-- expect: new functions: invoker, empty search_path, no API role executes = 예
-- expect: no other DB function names the new tables = 예
with t as (select to_regclass('public.app_cron_keys') as k,to_regclass('public.app_feed_runs') as r,to_regclass('public.app_feed_jobs') as j),
f as (select count(*) as n,
  count(*) filter(where not p.prosecdef and p.proconfig=array['search_path=""'] and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')) as shaped
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
  where s.nspname='private' and p.proname in ('app_feed_enqueue','app_feed_claim','app_feed_sent','app_feed_settle','app_feed_tidy')),
history as (select count(*) filter(where name='feed_cron_tables') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261106040000'),
tabs as (select c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relacl from pg_catalog.pg_class c
  where c.oid in (select k from t union all select r from t union all select j from t) and c.oid is not null)
select 'tables, functions and history agree' as item,case when
  (history.n=0 and (select k from t) is null and (select r from t) is null and (select j from t) is null and f.n=0)
  or (history.n=1 and history.named=1 and (select k from t) is not null and (select r from t) is not null and (select j from t) is not null and f.n=5)
  then '예' else '아니오' end as ok
  from history,f
union all select 'new tables: RLS on, no policies',case when not exists(select 1 from tabs where not relrowsecurity or relforcerowsecurity)
  and not exists(select 1 from pg_catalog.pg_policy where polrelid in (select oid from tabs)) then '예' else '아니오' end
union all select 'new tables: no anon, authenticated or PUBLIC privileges',case when
  not exists(select 1 from tabs where coalesce(relacl::text,'') ~ '(^|[{,])(anon|authenticated)?=')
  and not exists(select 1 from pg_catalog.pg_attribute where attrelid in (select oid from tabs) and attacl is not null)
  and not exists(select 1 from tabs where has_table_privilege('anon',oid,'select,insert,update,delete,truncate,references,trigger')
    or has_table_privilege('authenticated',oid,'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'new tables: service_role select only',case when
  not exists(select 1 from tabs where not has_table_privilege('service_role',oid,'select')
    or has_table_privilege('service_role',oid,'insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'new functions: invoker, empty search_path, no API role executes',case when f.shaped=f.n
  and not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='private' and p.proname in ('app_feed_enqueue','app_feed_claim','app_feed_sent','app_feed_settle','app_feed_tidy')
      and (coalesce(p.proacl::text,'') ~ '(^|[{,])(anon|authenticated|service_role)?='
        or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute'))) then '예' else '아니오' end
  from f
union all select 'no other DB function names the new tables',case when not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
  where p.prosrc ~ '(app_cron_keys|app_feed_runs|app_feed_jobs)'
    and not (s.nspname='private' and p.proname in ('app_feed_enqueue','app_feed_claim','app_feed_sent','app_feed_settle','app_feed_tidy'))) then '예' else '아니오' end;
