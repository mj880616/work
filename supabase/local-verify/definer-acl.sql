-- Read-only pg_catalog metadata for ten reviewed SECURITY DEFINER candidates.
-- No table rows, function definitions, default expressions, or secrets.
select json_build_object(
  'name',n.nspname||'.'||p.proname,
  'returns',p.prorettype::regtype::text,
  'definer',p.prosecdef,
  'searchPath',coalesce((select bool_or(x like 'search_path=%') from unnest(p.proconfig) x),false),
  'uuidInput',p.proargtypes::text like '%'||'2950'||'%',
  'publicAclDefault',p.proacl is null,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'anonSchemaUsage',has_schema_privilege('anon',n.oid,'USAGE'),
  'authenticatedSchemaUsage',has_schema_privilege('authenticated',n.oid,'USAGE'),
  'serviceSchemaUsage',has_schema_privilege('service_role',n.oid,'USAGE')
)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname in (
  'app_can_edit_space','app_can_edit_suborganization','app_can_manage_space',
  'app_can_view_event','app_can_view_space','app_enforce_workspace_member_role',
  'app_link_profile_workplace_org','app_seed_child_project_management',
  'app_sync_profile_workplace_name','app_task_child_project_guard'
)
order by p.proname;
