-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New tables only, so the snapshot proves they do not exist yet and records the existing helpers and the documents table shape they rely on.
select 'table' as kind,'public.app_library_folders' as name,coalesce(to_regclass('public.app_library_folders')::text,'absent') as definition
union all select 'table','public.app_library_folder_items',coalesce(to_regclass('public.app_library_folder_items')::text,'absent')
union all select 'function','private.app_library_folder_tree_guard()',coalesce(to_regprocedure('private.app_library_folder_tree_guard()')::text,'absent')
union all select 'function','private.app_library_folder_lift()',coalesce(to_regprocedure('private.app_library_folder_lift()')::text,'absent')
union all select 'helper function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('private.app_space_in_workspace(uuid,uuid)'))
union all select 'documents policy',pol.polname::text,md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'|'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
  from pg_policy pol where pol.polrelid=to_regclass('public.app_documents')
union all select 'documents ACL','public.app_documents',coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),'none')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261022120000'
order by 1,2;
