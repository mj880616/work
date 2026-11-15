-- SELECT only. Save before apply. New tables only: proves the ledger objects do not exist yet and records the owner
-- check function and default privileges this migration relies on (definition hash, no row values).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_ledger_imports','public.app_ledger_id_counters','public.app_ledger_topics','public.app_ledger_organizations',
    'public.app_ledger_sources','public.app_ledger_records','public.app_ledger_record_sources','public.app_ledger_links',
    'public.app_ledger_candidates','public.app_ledger_audit']) n
union all select 'ledger function',p.oid::regprocedure::text,'present' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname like 'app\_ledger\_%'
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261021082000'
order by 1,2;
