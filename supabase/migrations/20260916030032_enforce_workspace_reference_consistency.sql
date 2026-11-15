-- Applied to Supabase project xmlkxfjeagycwttklxjw on 2026-09-16.
-- Prevent cross-workspace references even when a caller has permissions in multiple workspaces.

create or replace function private.app_space_in_workspace(p_space uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_space is null or exists (
    select 1 from public.app_spaces s
    where s.id = p_space and s.workspace_id = p_workspace
  )
$$;

create or replace function private.app_workstream_in_context(p_workstream uuid, p_project uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_workstream is null or (
    p_project is not null and exists (
      select 1 from public.app_project_workstreams w
      join public.app_spaces s on s.id = w.project_id
      where w.id = p_workstream
        and w.project_id = p_project
        and s.workspace_id = p_workspace
    )
  )
$$;

create or replace function private.app_event_in_workspace(p_event uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_event is null or exists (
    select 1 from public.app_events e
    where e.id = p_event and e.workspace_id = p_workspace
  )
$$;

create or replace function private.app_meeting_in_workspace(p_meeting uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_meeting is null or exists (
    select 1 from public.app_meetings m
    where m.id = p_meeting and m.workspace_id = p_workspace
  )
$$;

revoke all on function private.app_space_in_workspace(uuid,uuid) from public;
revoke all on function private.app_workstream_in_context(uuid,uuid,uuid) from public;
revoke all on function private.app_event_in_workspace(uuid,uuid) from public;
revoke all on function private.app_meeting_in_workspace(uuid,uuid) from public;
grant execute on function private.app_space_in_workspace(uuid,uuid) to authenticated, service_role;
grant execute on function private.app_workstream_in_context(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function private.app_event_in_workspace(uuid,uuid) to authenticated, service_role;
grant execute on function private.app_meeting_in_workspace(uuid,uuid) to authenticated, service_role;

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

revoke all on function private.app_enforce_workspace_links() from public;

create or replace function private.app_enforce_space_workspace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception using errcode='23514', message='project workspace_id is immutable';
  end if;

  if new.parent_id is not null and not exists (
    select 1 from public.app_spaces p
    where p.id = new.parent_id and p.workspace_id = new.workspace_id
  ) then
    raise exception using errcode='23514', message='parent project must belong to the same workspace';
  end if;

  return new;
end
$$;

revoke all on function private.app_enforce_space_workspace() from public;

drop trigger if exists app_spaces_workspace_consistency on public.app_spaces;
create trigger app_spaces_workspace_consistency before insert or update on public.app_spaces for each row execute function private.app_enforce_space_workspace();
drop trigger if exists app_documents_workspace_consistency on public.app_documents;
create trigger app_documents_workspace_consistency before insert or update on public.app_documents for each row execute function private.app_enforce_workspace_links();
drop trigger if exists app_events_workspace_consistency on public.app_events;
create trigger app_events_workspace_consistency before insert or update on public.app_events for each row execute function private.app_enforce_workspace_links();
drop trigger if exists app_meetings_workspace_consistency on public.app_meetings;
create trigger app_meetings_workspace_consistency before insert or update on public.app_meetings for each row execute function private.app_enforce_workspace_links();
drop trigger if exists app_tasks_workspace_consistency on public.app_tasks;
create trigger app_tasks_workspace_consistency before insert or update on public.app_tasks for each row execute function private.app_enforce_workspace_links();
drop trigger if exists app_pages_workspace_consistency on public.app_pages;
create trigger app_pages_workspace_consistency before insert or update on public.app_pages for each row execute function private.app_enforce_workspace_links();
drop trigger if exists app_project_invitations_workspace_consistency on public.app_project_invitations;
create trigger app_project_invitations_workspace_consistency before insert or update on public.app_project_invitations for each row execute function private.app_enforce_workspace_links();
