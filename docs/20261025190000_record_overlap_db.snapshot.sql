-- SELECT only. Save before apply. New objects only, so the snapshot proves they do not exist yet and records
-- the owner check function this migration relies on (definition hash, no row values) and the tables it reads (existence only).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_record_overlaps','public.app_meetings','public.app_notes','public.app_spaces','public.app_suborganizations','public.app_project_progress_updates','public.app_suborganization_updates','public.app_record_links']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['public.app_record_overlap_set(uuid,jsonb)','private.app_record_overlap_guard()']) n
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace in ('public'::regnamespace,'private'::regnamespace)
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261025190000'
order by 1,2;
