with target_tables(table_name) as (
  values
    ('app_ai_conversations'),('app_ai_daily_usage'),('app_ai_messages'),('app_ai_workspace_settings'),
    ('app_direct_messages'),('app_document_ai_index'),('app_document_chunks'),('app_documents'),
    ('app_event_attendees'),('app_event_comments'),('app_event_photos'),('app_event_suborganizations'),('app_events'),
    ('app_invites'),('app_meetings'),('app_org_affiliation_tags'),('app_pages'),
    ('app_profile_report_projects'),('app_profile_weekly_reports'),('app_profile_workplace_statuses'),
    ('app_profile_workplaces'),('app_profiles'),('app_suborganization_affiliations'),
    ('app_suborganization_assignees'),('app_suborganization_status_items'),('app_suborganization_timeline'),
    ('app_suborganization_updates'),('app_suborganization_weekly_reports'),('app_suborganizations'),
    ('app_tasks'),('app_workspace_members'),('app_workspaces')
), target_functions(schema_name,function_name) as (
  values
    ('private','app_is_workspace_admin'),
    ('public','app_can_edit_page_rpc'),('public','app_create_invite'),('public','app_delete_pages'),
    ('public','app_open_share'),('public','app_save_page_v2'),('public','app_set_workspace_member_role'),
    ('public','app_update_event_body'),('public','app_accept_invite'),('public','app_claim_owner'),
    ('public','app_request_workspace_access'),('public','app_respond_project_invitation'),
    ('public','app_public_workspace_snapshot'),('public','app_public_post'),('public','app_public_workspace_index')
), table_state as (
  select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join target_tables t on t.table_name=c.relname
  where n.nspname='public' and c.relkind in ('r','p')
), policies as (
  select p.tablename,p.policyname,p.cmd,p.roles,p.qual,p.with_check
  from pg_catalog.pg_policies p join target_tables t on t.table_name=p.tablename
  where p.schemaname='public'
), grants as (
  select g.table_name,g.grantee,g.privilege_type,g.is_grantable
  from information_schema.role_table_grants g join target_tables t on t.table_name=g.table_name
  where g.table_schema='public' and g.grantee in ('PUBLIC','anon','authenticated','service_role')
), functions as (
  select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,p.proconfig,
         regexp_replace(p.prosrc,'\s','','g') as normalized_source,
         pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
         pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
         pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join target_functions t on t.schema_name=n.nspname and t.function_name=p.proname
)
select 'tables=' || md5((select coalesce(jsonb_agg(to_jsonb(s) order by relname),'[]'::jsonb) from table_state s)::text)
union all
select 'policies=' || md5((select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname,cmd),'[]'::jsonb) from policies p)::text)
union all
select 'grants=' || md5((select coalesce(jsonb_agg(to_jsonb(g) order by table_name,grantee,privilege_type),'[]'::jsonb) from grants g)::text)
union all
select 'functions=' || md5((select coalesce(jsonb_agg(to_jsonb(f) order by nspname,proname,args),'[]'::jsonb) from functions f)::text);
