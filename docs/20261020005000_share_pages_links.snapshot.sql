-- SELECT only. Save before apply. New tables only, so the snapshot proves they do not exist yet and records
-- the owner check functions this migration relies on (definition hash, no row values).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_share_pages','public.app_share_page_links']) n
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('private.app_space_in_workspace(uuid,uuid)'))
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261020005000'
order by 1,2;
