-- Ensure project deletion unlinks retained records before cascading project/workstream deletes.
-- Linked tasks, events, meetings, documents, and pages are preserved; only their
-- project/workstream linkage is cleared. Project-owned data continues to cascade.

create or replace function private.app_unlink_retained_project_records()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_projects uuid[];
  v_workstreams uuid[];
begin
  with recursive project_tree as (
    select old.id
    union all
    select s.id
    from public.app_spaces s
    join project_tree p on s.parent_id = p.id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_projects
  from project_tree;

  select coalesce(array_agg(w.id), array[]::uuid[])
  into v_workstreams
  from public.app_project_workstreams w
  where w.project_id = any(v_projects);

  update public.app_tasks
  set project_id = case when project_id = any(v_projects) then null else project_id end,
      workstream_id = case when workstream_id = any(v_workstreams) then null else workstream_id end,
      source_id = case
        when source_type = 'project' and source_id = any(v_projects) then null
        else source_id
      end,
      source_type = case
        when source_type = 'project' and source_id = any(v_projects) then null
        else source_type
      end
  where project_id = any(v_projects)
     or workstream_id = any(v_workstreams)
     or (source_type = 'project' and source_id = any(v_projects));

  update public.app_events
  set project_id = case when project_id = any(v_projects) then null else project_id end,
      workstream_id = case when workstream_id = any(v_workstreams) then null else workstream_id end
  where project_id = any(v_projects)
     or workstream_id = any(v_workstreams);

  update public.app_meetings
  set project_id = case when project_id = any(v_projects) then null else project_id end,
      workstream_id = case when workstream_id = any(v_workstreams) then null else workstream_id end
  where project_id = any(v_projects)
     or workstream_id = any(v_workstreams);

  update public.app_documents
  set project_id = case when project_id = any(v_projects) then null else project_id end,
      workstream_id = case when workstream_id = any(v_workstreams) then null else workstream_id end
  where project_id = any(v_projects)
     or workstream_id = any(v_workstreams);

  update public.app_pages
  set space_id = case when space_id = any(v_projects) then null else space_id end,
      workstream_id = case when workstream_id = any(v_workstreams) then null else workstream_id end
  where space_id = any(v_projects)
     or workstream_id = any(v_workstreams);

  return old;
end
$$;

revoke all on function private.app_unlink_retained_project_records() from public;

drop trigger if exists app_spaces_unlink_retained_records_before_delete on public.app_spaces;
create trigger app_spaces_unlink_retained_records_before_delete
before delete on public.app_spaces
for each row
execute function private.app_unlink_retained_project_records();
