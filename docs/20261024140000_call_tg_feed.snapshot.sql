-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New tables only, so the snapshot proves they do not exist yet and records the existing helpers the policies and trigger rely on.
select 'table' as kind,'public.app_feed_items' as name,coalesce(to_regclass('public.app_feed_items')::text,'absent') as definition
union all select 'table','public.app_feed_days',coalesce(to_regclass('public.app_feed_days')::text,'absent')
union all select 'function','private.app_feed_item_guard()',coalesce(to_regprocedure('private.app_feed_item_guard()')::text,'absent')
union all select 'helper function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('private.app_space_in_workspace(uuid,uuid)'))
union all select 'organizations ACL','public.app_suborganizations',coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_suborganizations')),'none')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261024140000'
order by 1,2;
