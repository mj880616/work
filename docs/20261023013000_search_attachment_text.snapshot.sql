-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Records the current search function (definition hash, options, ACL) so rollback can be compared, plus what it relies on.
select 'search function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.proname='app_search_records' and p.pronamespace='public'::regnamespace
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname='app_documents'
union all select 'policy',c.relname::text||'.'||p.polname::text,md5(p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname='app_documents'
union all select 'index',i.indexrelid::regclass::text,md5(pg_get_indexdef(i.indexrelid))
  from pg_index i where i.indrelid=to_regclass('public.app_documents')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261022150000','20261023013000')
order by 1,2;
