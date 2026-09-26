-- Web1-4 production pre-migration snapshot (read-only).
-- Target: xmlkxfjeagycwttklxjw. Captured 2026-09-26 through the read-only MCP.
-- Re-run this entire file right before applying the paired migration and stop
-- if any value differs from the captured values below.

-- Captured values:
-- signature: public.app_delete_pages(uuid[])
-- owner: postgres; security definer: true; volatility: v
-- proconfig: {"search_path=pg_catalog, public, private"}
-- proacl: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- md5(pg_get_functiondef): 0566f0fef618a1905b9a606a6e913576
-- dependents: no function body, view, or policy references it

select p.oid::regprocedure as signature,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef,
       p.provolatile,
       p.proconfig,
       p.proacl::text as acl,
       md5(pg_get_functiondef(p.oid)) as def_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'app_delete_pages';

select
  (select count(*) from pg_proc p2
    where p2.proname <> 'app_delete_pages' and p2.prosrc ilike '%app_delete_pages%') as function_refs,
  (select count(*) from pg_views where definition ilike '%app_delete_pages%') as view_refs,
  (select count(*) from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') ilike '%app_delete_pages%') as policy_refs;
