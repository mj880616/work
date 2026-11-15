-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New tables and functions: proves they do not exist yet. app_documents: the definitions the new functions rely on.
select 'new object' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_library_tidy_backups','public.app_library_tidy_attempts']) n
union all select 'new function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['public.app_library_auto_tidy_apply(uuid,jsonb)','public.app_library_auto_tidy_revert(uuid)']) n
union all select 'documents column',a.attname,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':acl='||coalesce(a.attacl::text,'none')
  from pg_attribute a where a.attrelid=to_regclass('public.app_documents') and a.attnum>0 and not a.attisdropped
union all select 'documents constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_documents')
union all select 'documents policy',polname,polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents trigger',tgname,tgenabled::text from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'documents owner RLS grants',relname,relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_documents')
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261022212757'
order by 1,2;
