-- SELECT only. Run after apply (all 예 expected) or after rollback (functions and history agree = 예, the others 아니오).
-- 표·정책·권한·다른 트리거·앞 단계 함수는 바뀌지 않는다: snapshot의 ledger table·policies 줄과 같아야 하고,
-- ledger triggers 줄은 app_ledger_candidates의 guard 함수 이름만 달라야 한다.
with f as (
  select p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname in('app_unconfirm_ledger_candidate','app_guard_ledger_candidate')
), history as (
  select count(*) filter(where name='ledger_candidate_undo') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261021234000'
)
select 'functions and history agree' as item,case when (history.n=0 and (select count(*) from f)=0)
  or (history.n=1 and history.named=1 and (select count(*) from f)=2) then '예' else '아니오' end as ok from history
union all select 'two undo functions present',case when (select count(*) from f)=2
  and (select bool_and(oid::regprocedure::text in('app_unconfirm_ledger_candidate(uuid)','private.app_guard_ledger_candidate()')) from f)
  then '예' else '아니오' end
union all select 'all security invoker, empty search_path',case when (select count(*) from f)=2 and (select bool_and(not prosecdef and proconfig=array['search_path=""']) from f) then '예' else '아니오' end
union all select 'undo function: authenticated only (no PUBLIC, anon, service_role)',case when exists(select 1 from f where proname='app_unconfirm_ledger_candidate'
    and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
    and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0))
  then '예' else '아니오' end
union all select 'guard function: no direct execute (PUBLIC, anon, authenticated, service_role)',case when exists(select 1 from f where proname='app_guard_ledger_candidate'
    and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
    and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0))
  then '예' else '아니오' end
union all select 'candidate guard trigger uses the new guard',case when exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.app_ledger_candidates') and t.tgname='app_ledger_candidates_guard' and t.tgfoid=to_regprocedure('private.app_guard_ledger_candidate()') and t.tgenabled='O') then '예' else '아니오' end
union all select 'import guard trigger unchanged',case when exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.app_ledger_imports') and t.tgname='app_ledger_imports_guard' and t.tgfoid=to_regprocedure('private.app_ledger_decided_guard()') and t.tgenabled='O') then '예' else '아니오' end
union all select 'ledger functions unchanged (6)',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_ledger\_%')=6 then '예' else '아니오' end
union all select 'ledger tables still RLS (10)',case when (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%' and relrowsecurity)=10 then '예' else '아니오' end;
