-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
select 'constraint' as kind,conrelid::regclass::text||'.'||conname as name,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'category function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'app_document_%categor%'
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||md5(p.prosrc) from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_workspace_owner'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261018112943','20261031000000')
order by 1,2;
