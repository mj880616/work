-- SELECT only. After apply: all 예. After rollback: first row 예 (tables, functions and history absent), the rest 예 by absence.
with t as (
  select c.oid,c.relname,c.relrowsecurity,c.relacl from pg_class c
  where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%' and c.relkind='r'
), f as (
  select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname like 'app\_ledger\_%'
), pol as (
  select p.* from pg_policy p join t on t.oid=p.polrelid
), history as (
  select count(*) filter(where name='ledger_schema') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261021082000'
)
select 'tables, functions and history agree' as item,case when
  (history.n=0 and (select count(*) from t)=0 and (select count(*) from f)=0)
  or (history.n=1 and history.named=1 and (select count(*) from t)=10 and (select count(*) from f)=6) then '예' else '아니오' end as ok from history
union all select 'RLS enabled on every ledger table',case when not exists(select 1 from t where not relrowsecurity) then '예' else '아니오' end
union all select 'owner policies only (authenticated)',case when not exists(select 1 from pol where polroles<>array['authenticated'::regrole]::oid[]
  or (polpermissive and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) not like '%app_is_workspace_owner(workspace_id)%')
  or (not polpermissive and polcmd<>'d'))
  and ((select count(*) from t)=0 or ((select count(*) from pol where polpermissive)=12 and (select count(*) from pol where not polpermissive)=4)) then '예' else '아니오' end
union all select 'anon and service_role have no table or column privilege',case when not exists(select 1 from t where
  has_table_privilege('anon',oid,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',oid,'select,insert,update,references')
  or has_table_privilege('service_role',oid,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('service_role',oid,'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when not exists(select 1 from t where relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'audit is append-only for the owner',case when (select count(*) from t)=0 or (
  not has_table_privilege('authenticated','public.app_ledger_audit','update')
  and not has_any_column_privilege('authenticated','public.app_ledger_audit','update')) then '예' else '아니오' end
union all select 'ids and workspace cannot be edited',case when (select count(*) from t)=0 or (
  not has_column_privilege('authenticated','public.app_ledger_records','ledger_id','update')
  and not has_column_privilege('authenticated','public.app_ledger_records','workspace_id','update')
  and not has_column_privilege('authenticated','public.app_ledger_records','kind','update')
  and not has_column_privilege('authenticated','public.app_ledger_sources','ledger_id','update')
  and not has_column_privilege('authenticated','public.app_ledger_candidates','origin','update')) then '예' else '아니오' end
union all select 'functions are security invoker with empty search_path',case when not exists(select 1 from f where prosecdef or proconfig is distinct from array['search_path=""']) then '예' else '아니오' end
union all select 'only search is callable, by authenticated only',case when (select count(*) from f)=0 or (
  (select bool_and(has_function_privilege('authenticated',oid,'execute')=(proname='app_ledger_search')
     and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from f)) then '예' else '아니오' end
union all select 'triggers in place',case when (select count(*) from t)=0 or (select count(*) from pg_trigger g join t on t.oid=g.tgrelid where not g.tgisinternal and g.tgenabled='O')=21 then '예' else '아니오' end;
