begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.app_is_workspace_owner(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_workspace_members wm
    where wm.workspace_id = p_workspace
      and wm.user_id = (select auth.uid())
      and wm.role = 'owner'
  )
$$;

create or replace function private.app_is_owner_document(p_document uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(d.workspace_id)
    from public.app_documents d where d.id = p_document
  ), false)
$$;

create or replace function private.app_is_owner_event(p_event uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(e.workspace_id)
    from public.app_events e where e.id = p_event
  ), false)
$$;

create or replace function private.app_is_owner_organization(p_organization uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(o.workspace_id)
    from public.app_suborganizations o where o.id = p_organization
  ), false)
$$;

create or replace function private.app_is_owner_profile(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_workspace_members subject
    join public.app_workspace_members owner
      on owner.workspace_id = subject.workspace_id
     and owner.role = 'owner'
     and owner.user_id = (select auth.uid())
    where subject.user_id = p_user
  )
$$;

create or replace function private.app_is_owner_workplace(p_workplace uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_owner_profile(w.user_id)
    from public.app_profile_workplaces w where w.id = p_workplace
  ), false)
$$;

create or replace function private.app_is_owner_conversation(p_conversation uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(c.workspace_id)
    from public.app_ai_conversations c where c.id = p_conversation
  ), false)
$$;

revoke all on function private.app_is_workspace_owner(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_document(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_event(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_organization(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_profile(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_workplace(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_conversation(uuid) from PUBLIC, anon, authenticated;
grant execute on function private.app_is_workspace_owner(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_document(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_event(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_organization(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_workplace(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_conversation(uuid) to authenticated, service_role;

do $policy_reset$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'app_ai_conversations','app_ai_daily_usage','app_ai_messages','app_ai_workspace_settings',
        'app_direct_messages','app_document_ai_index','app_document_chunks','app_documents',
        'app_event_attendees','app_event_comments','app_event_photos','app_event_suborganizations','app_events',
        'app_meetings','app_org_affiliation_tags','app_pages','app_profile_report_projects',
        'app_profile_weekly_reports','app_profile_workplace_statuses','app_profile_workplaces','app_profiles',
        'app_invites','app_suborganization_affiliations','app_suborganization_assignees',
        'app_suborganization_status_items','app_suborganization_timeline','app_suborganization_updates',
        'app_suborganization_weekly_reports','app_suborganizations','app_tasks','app_workspace_members','app_workspaces'
      ]::text[])
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$policy_reset$;

create policy task12a_owner_all on public.app_ai_conversations for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_ai_daily_usage for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_ai_messages for all to authenticated
using (private.app_is_owner_conversation(conversation_id)) with check (private.app_is_owner_conversation(conversation_id));
create policy task12a_owner_all on public.app_ai_workspace_settings for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_direct_messages for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_document_ai_index for all to authenticated
using (private.app_is_owner_document(document_id)) with check (private.app_is_owner_document(document_id));
create policy task12a_owner_all on public.app_document_chunks for all to authenticated
using (private.app_is_owner_document(document_id)) with check (private.app_is_owner_document(document_id));
create policy task12a_owner_all on public.app_documents for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_event_attendees for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_comments for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_photos for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_suborganizations for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_events for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_meetings for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_org_affiliation_tags for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_pages for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_profile_report_projects for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profile_weekly_reports for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profile_workplace_statuses for all to authenticated
using (private.app_is_owner_workplace(workplace_id)) with check (private.app_is_owner_workplace(workplace_id));
create policy task12a_owner_all on public.app_profile_workplaces for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profiles for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_profile_self_select on public.app_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy task12a_owner_all on public.app_invites for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_suborganization_affiliations for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_assignees for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_status_items for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_timeline for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_updates for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_weekly_reports for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganizations for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_tasks for all to authenticated
using (private.app_is_workspace_owner(workspace_id))
with check (
  private.app_is_workspace_owner(workspace_id)
  and private.app_space_in_workspace(project_id, workspace_id)
  and private.app_workstream_in_context(workstream_id, project_id, workspace_id)
  and private.app_user_in_workspace(assignee_id, workspace_id)
  and (
    coalesce(source_type, 'manual') = 'manual'
    or (source_type = 'meeting' and source_id is not null and private.app_meeting_in_workspace(source_id, workspace_id))
    or (source_type = 'project' and project_id is not null and private.app_can_edit_space(project_id))
  )
);
create policy task12a_owner_all on public.app_workspace_members for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_member_self_select on public.app_workspace_members for select to authenticated
using (user_id = (select auth.uid()));
create policy task12a_owner_all on public.app_workspaces for all to authenticated
using (private.app_is_workspace_owner(id)) with check (private.app_is_workspace_owner(id));

commit;
