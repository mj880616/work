-- SELECT only. Run after apply (all 예 expected) or after rollback (functions and history agree = 예, the others 아니오 or 예 as noted).
-- 표·정책·트리거·원장 함수 6개는 바뀌지 않는다: snapshot의 ledger policies·triggers·function 줄과 같아야 한다.
with f as (
  select p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname like 'app\_import\_ledger\_%'
), history as (
  select count(*) filter(where name='ledger_import') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261021150000'
)
select 'functions and history agree' as item,case when (history.n=0 and (select count(*) from f)=0)
  or (history.n=1 and history.named=1 and (select count(*) from f)=4) then '예' else '아니오' end as ok from history
union all select 'four import functions present',case when (select count(*) from f)=4
  and (select bool_and(oid::regprocedure::text in('app_import_ledger_apply(uuid,jsonb,boolean)','app_import_ledger_counts(uuid)','app_import_ledger_confirm(uuid)','app_import_ledger_revert(uuid)')) from f)
  then '예' else '아니오' end
union all select 'all security invoker, empty search_path',case when (select count(*) from f)=4 and (select bool_and(not prosecdef and proconfig=array['search_path=""']) from f) then '예' else '아니오' end
union all select 'authenticated only (no PUBLIC, anon, service_role)',case when (select count(*) from f)=4 and (select bool_and(
    has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
    and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',(select proowner from pg_proc x where x.oid=f.oid)))) a where a.grantee=0)) from f)
  then '예' else '아니오' end
union all select 'ledger functions unchanged (6)',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_ledger\_%')=6 then '예' else '아니오' end
union all select 'ledger tables still RLS (10)',case when (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%' and relrowsecurity)=10 then '예' else '아니오' end;
