-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New table and functions: proves they do not exist yet. app_documents / app_library_tidy_backups: the definitions this file changes or relies on.
select 'new object' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_library_classify_attempts']) n
union all select 'new function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['public.app_library_classify_apply(uuid,jsonb)','public.app_library_classify_revert(uuid)','public.app_library_classify_revert_since(timestamptz)']) n
union all select 'documents constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_documents')
union all select 'backups constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_library_tidy_backups')
union all select 'documents policy',polname,polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents trigger',tgname,tgenabled::text from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'owner RLS grants',relname,relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid in (to_regclass('public.app_documents'),to_regclass('public.app_library_tidy_backups'),to_regclass('public.app_spaces'),to_regclass('public.app_suborganizations'))
union all select 'link columns',c.relname||'.'||a.attname,format_type(a.atttypid,a.atttypmod)
  from pg_attribute a join pg_class c on c.oid=a.attrelid
  where a.attrelid in (to_regclass('public.app_spaces'),to_regclass('public.app_suborganizations')) and a.attname in ('status','active','workspace_id') and not a.attisdropped
union all select 'existing tidy functions',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('public.app_library_auto_tidy_apply(uuid,jsonb)'),to_regprocedure('public.app_library_auto_tidy_revert(uuid)'))
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261022212757','20261023120000')
order by 1,2;
