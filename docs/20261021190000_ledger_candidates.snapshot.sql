-- SELECT only. Save before apply. Proves the two candidate functions do not exist yet and records the ledger table
-- policies, grants, triggers and the earlier ledger functions this migration relies on (definition hash only, no row values).
select 'candidate function' as kind,p.oid::regprocedure::text as name,'present' as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname in('app_confirm_ledger_candidate','app_queue_ledger_candidates')
union all select 'ledger table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'app\_ledger\_%'
union all select 'ledger policies',c.relname::text,md5(coalesce(string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname),''))
  from pg_class c join pg_policy p on p.polrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%' group by c.relname
union all select 'ledger triggers',c.relname::text,string_agg(t.tgname::text||':'||t.tgenabled::text,',' order by t.tgname)
  from pg_class c join pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%' group by c.relname
union all select 'ledger function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and (p.proname like 'app\_ledger\_%' or p.proname like 'app\_import\_ledger\_%')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261021190000'
order by 1,2;
