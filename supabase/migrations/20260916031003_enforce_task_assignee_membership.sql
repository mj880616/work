-- Applied to Supabase project xmlkxfjeagycwttklxjw on 2026-09-16.
-- Prevent app_tasks.assignee_id from referencing users outside the task workspace.

create or replace function private.app_user_in_workspace(p_user uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_user is not null and exists (
    select 1 from public.app_workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user
  )
$$;

revoke all on function private.app_user_in_workspace(uuid,uuid) from public;
grant execute on function private.app_user_in_workspace(uuid,uuid) to authenticated, service_role;

create or replace function private.app_enforce_workspace_links()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  j jsonb := to_jsonb(new);
  v_project uuid;
  v_workstream uuid;
  v_event uuid;
  v_meeting uuid;
  v_source uuid;
  v_source_type text;
  v_assignee uuid;
begin
  v_project := nullif(coalesce(j->>'project_id', j->>'space_id'), '')::uuid;
  v_workstream := nullif(j->>'workstream_id', '')::uuid;

  if not private.app_space_in_workspace(v_project, new.workspace_id) then
    raise exception using errcode='23514', message='project/space must belong to the same workspace';
  end if;
  if not private.app_workstream_in_context(v_workstream, v_project, new.workspace_id) then
    raise exception using errcode='23514', message='workstream must belong to the selected project and workspace';
  end if;

  if tg_table_name in ('app_documents','app_meetings') then
    v_event := nullif(j->>'event_id', '')::uuid;
    if not private.app_event_in_workspace(v_event, new.workspace_id) then
      raise exception using errcode='23514', message='event must belong to the same workspace';
    end if;
  end if;

  if tg_table_name = 'app_documents' then
    v_meeting := nullif(j->>'meeting_id', '')::uuid;
    if not private.app_meeting_in_workspace(v_meeting, new.workspace_id) then
      raise exception using errcode='23514', message='meeting must belong to the same workspace';
    end if;
  end if;

  if tg_table_name = 'app_tasks' then
    v_assignee := nullif(j->>'assignee_id', '')::uuid;
    if not private.app_user_in_workspace(v_assignee, new.workspace_id) then
      raise exception using errcode='23514', message='task assignee must be a member of the same workspace';
    end if;

    v_source_type := j->>'source_type';
    v_source := nullif(j->>'source_id', '')::uuid;
    if v_source is not null and v_source_type = 'meeting'
       and not private.app_meeting_in_workspace(v_source, new.workspace_id) then
      raise exception using errcode='23514', message='meeting task source must belong to the same workspace';
    elsif v_source is not null and v_source_type = 'event'
       and not private.app_event_in_workspace(v_source, new.workspace_id) then
      raise exception using errcode='23514', message='event task source must belong to the same workspace';
    elsif v_source is not null and v_source_type = 'project'
       and v_source is distinct from v_project then
      raise exception using errcode='23514', message='project task source must match project_id';
    end if;
  end if;

  return new;
end
$$;

alter policy app_tasks_scoped_insert on public.app_tasks
with check (
  created_by = auth.uid()
  and private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20
  and ((project_id is null) or private.app_can_edit_space(project_id))
  and private.app_space_in_workspace(project_id, workspace_id)
  and private.app_workstream_in_context(workstream_id, project_id, workspace_id)
  and private.app_user_in_workspace(assignee_id, workspace_id)
  and (
    coalesce(source_type,'manual') = 'manual'
    or (
      source_type='meeting' and source_id is not null
      and private.app_meeting_in_workspace(source_id, workspace_id)
      and exists (
        select 1 from public.app_meetings m
        where m.id=source_id
          and (m.created_by=auth.uid() or private.app_role_rank(private.app_workspace_role(m.workspace_id)) >= 30)
      )
    )
    or (source_type='project' and project_id is not null and private.app_can_edit_space(project_id))
  )
);

alter policy app_tasks_scoped_update on public.app_tasks
using (
  ((project_id is null) and assignee_id = auth.uid())
  or (
    project_id is not null
    and private.app_can_view_space(project_id)
    and (created_by=auth.uid() or assignee_id=auth.uid() or private.app_can_edit_space(project_id))
  )
)
with check (
  private.app_space_in_workspace(project_id, workspace_id)
  and private.app_workstream_in_context(workstream_id, project_id, workspace_id)
  and private.app_user_in_workspace(assignee_id, workspace_id)
  and (
    ((project_id is null) and assignee_id = auth.uid())
    or (
      project_id is not null
      and private.app_can_view_space(project_id)
      and (created_by=auth.uid() or assignee_id=auth.uid() or private.app_can_edit_space(project_id))
    )
  )
);
