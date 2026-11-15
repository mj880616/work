-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New table only, so the snapshot proves it does not exist yet and records the existing helper the policy relies on.
select 'table' as kind,'public.app_tg_personal_days' as name,coalesce(to_regclass('public.app_tg_personal_days')::text,'absent') as definition
union all select 'helper function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261025030000'
order by 1,2;
