-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New function only: proves no app_search_records exists yet and records what the INVOKER function relies on
-- (owner check function definition, search tables' RLS flag and ACL, policies) as hashes.
select 'search function' as kind,'public.app_search_records' as name,coalesce((select string_agg(p.oid::regprocedure::text,',') from pg_proc p
  where p.proname='app_search_records' and p.pronamespace='public'::regnamespace),'absent') as definition
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_notes','app_record_links','app_documents','app_meetings','app_spaces',
  'app_project_progress_updates','app_project_milestones','app_suborganizations','app_suborganization_updates','app_suborganization_timeline')
union all select 'policy',c.relname::text||'.'||p.polname::text,md5(p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname in('app_notes','app_record_links','app_documents','app_meetings','app_spaces',
  'app_project_progress_updates','app_project_milestones','app_suborganizations','app_suborganization_updates','app_suborganization_timeline')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261022120000'
order by 1,2;
