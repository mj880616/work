-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_suborganizations (policies, triggers, owner·RLS·grants — unchanged by this migration), the new object names
-- (absent before apply) and the migration history.
select 'policy' as kind,c.relname||'.'||p.polname as name,p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') as definition
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid=to_regclass('public.app_suborganizations')
union all select 'trigger',c.relname||'.'||t.tgname,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgrelid=to_regclass('public.app_suborganizations') and not t.tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid=to_regclass('public.app_suborganizations')
union all select 'table',n,coalesce(to_regclass(n)::text,'absent') from unnest(array['public.app_dispute_stages','public.app_suborganization_dispute_stages']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent') from unnest(array['public.app_dispute_stage_delete(uuid,boolean)']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261024100000')
order by 1,2;
