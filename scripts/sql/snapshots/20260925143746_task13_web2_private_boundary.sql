-- Task 13 production pre-migration snapshot (read-only).
-- Target confirmed at Gate 1: xmlkxfjeagycwttklxjw / kptu-shared-checklists.
-- Re-run this entire file at Gate 3 and retain the output before applying the
-- paired migration. Never select share token values or personal row data.

-- Captured Gate 1 grants:
-- app_public_workspace_index(): anon, service_role
-- app_public_workspace_snapshot(): service_role
-- app_public_projects_snapshot(): service_role
-- app_public_project(text): service_role
-- app_public_suborganization_facets(): service_role
-- app_project_publication_state(uuid): service_role
-- app_set_project_publication(uuid,boolean,boolean,text): service_role
-- app_set_project_block_publication(uuid,boolean,boolean,integer): service_role
-- app_move_project_public_block(uuid,integer): service_role
-- app_create_share_link(uuid,timestamptz): service_role
-- app_open_share(text): authenticated, service_role
-- app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text): authenticated, service_role
-- app_public_post(text): anon, authenticated, service_role (preserve)

select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 25;

with targets(schema_name, function_name) as (
  values
    ('public','app_public_workspace_index'),
    ('public','app_public_workspace_snapshot'),
    ('public','app_public_projects_snapshot'),
    ('public','app_public_project'),
    ('public','app_public_suborganization_facets'),
    ('public','app_project_publication_state'),
    ('public','app_set_project_publication'),
    ('public','app_set_project_block_publication'),
    ('public','app_move_project_public_block'),
    ('public','app_create_share_link'),
    ('public','app_open_share'),
    ('public','app_save_page_v2'),
    ('public','app_public_post')
)
select n.nspname as schema_name,
       p.oid::regprocedure::text as signature,
       r.rolname as owner,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       p.proacl as acl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
join targets t on t.schema_name=n.nspname and t.function_name=p.proname
order by 1,2;

select p.oid::regprocedure::text as referencing_function,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private')
  and p.prokind in ('f','p')
  and pg_get_functiondef(p.oid) ~
    'app_(public_workspace_index|public_workspace_snapshot|public_projects_snapshot|public_project|public_suborganization_facets|project_publication_state|set_project_publication|set_project_block_publication|move_project_public_block|create_share_link|open_share|save_page_v2)'
order by 1;

with target_oids as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'app_public_workspace_index','app_public_workspace_snapshot',
    'app_public_projects_snapshot','app_public_project',
    'app_public_suborganization_facets','app_project_publication_state',
    'app_set_project_publication','app_set_project_block_publication',
    'app_move_project_public_block','app_create_share_link','app_open_share',
    'app_save_page_v2','app_public_post'
  )
)
select d.classid::regclass::text as dependent_catalog,
       d.objid,
       d.refclassid::regclass::text as referenced_catalog,
       d.refobjid,
       d.deptype
from pg_depend d
where d.refobjid in (select oid from target_oids)
order by 1,2,3,4;

select n.nspname as schema_name,
       c.relname as object_name,
       c.relkind,
       pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m')
  and pg_get_viewdef(c.oid, true) ~
    'app_(public_workspace_index|public_workspace_snapshot|public_projects_snapshot|public_project|public_suborganization_facets|project_publication_state|set_project_publication|set_project_block_publication|move_project_public_block|create_share_link|open_share|save_page_v2)'
order by 1,2;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where coalesce(qual,'') || coalesce(with_check,'') ~
  'app_(public_workspace_index|public_workspace_snapshot|public_projects_snapshot|public_project|public_suborganization_facets|project_publication_state|set_project_publication|set_project_block_publication|move_project_public_block|create_share_link|open_share|save_page_v2)'
order by 1,2,3;

select event_object_schema, event_object_table, trigger_name,
       action_timing, event_manipulation, action_statement
from information_schema.triggers
where action_statement ~
  'app_(public_workspace_index|public_workspace_snapshot|public_projects_snapshot|public_project|public_suborganization_facets|project_publication_state|set_project_publication|set_project_block_publication|move_project_public_block|create_share_link|open_share|save_page_v2)'
order by 1,2,3;

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'app_pages','app_documents','app_share_links','app_groups','app_group_members',
  'app_page_permissions','app_project_invitations','app_project_publications',
  'app_project_public_blocks'
)
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in (
  'app_pages','app_documents','app_share_links','app_groups','app_group_members',
  'app_page_permissions','app_project_invitations','app_project_publications',
  'app_project_public_blocks'
)
order by tablename, policyname;

select
  count(*) as total_share_rows,
  count(*) filter (where revoked_at is null and (expires_at is null or expires_at > now())) as active_share_rows,
  count(*) filter (where expires_at is not null and expires_at <= now()) as expired_share_rows,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at
from public.app_share_links;

select 'app_groups' as object_name, count(*) as row_count from public.app_groups
union all select 'app_group_members', count(*) from public.app_group_members
union all select 'app_page_permissions', count(*) from public.app_page_permissions
union all select 'app_project_invitations', count(*) from public.app_project_invitations
union all select 'app_project_publications', count(*) from public.app_project_publications
union all select 'app_project_public_blocks', count(*) from public.app_project_public_blocks
order by 1;
