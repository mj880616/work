-- No data or role names are emitted. Compare this digest at A and B.
select md5(jsonb_build_object(
  'pages_acl',(select c.relacl::text from pg_catalog.pg_class c where c.oid='public.app_pages'::regclass),
  'pages_policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles::text,p.polqual::text,p.polwithcheck::text) order by p.polname)
    from pg_catalog.pg_policy p where p.polrelid='public.app_pages'::regclass),
  'spaces_acl',(select c.relacl::text from pg_catalog.pg_class c where c.oid='public.app_spaces'::regclass),
  'documents_acl',(select c.relacl::text from pg_catalog.pg_class c where c.oid='public.app_documents'::regclass),
  'meetings_acl',(select c.relacl::text from pg_catalog.pg_class c where c.oid='public.app_meetings'::regclass),
  'old_share',(select p.proacl::text from pg_catalog.pg_proc p where p.oid='public.app_open_share(text)'::regprocedure),
  'old_projects',(select p.proacl::text from pg_catalog.pg_proc p where p.oid='public.app_public_projects_snapshot()'::regprocedure),
  'old_workspace',(select p.proacl::text from pg_catalog.pg_proc p where p.oid='public.app_public_workspace_snapshot()'::regprocedure)
)::text);
