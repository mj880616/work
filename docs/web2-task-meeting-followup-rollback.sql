-- TASK-meeting-followup PR 1 rollback. Meeting links are deleted; Google tasks remain.
-- Revert the Edge/app release first if it has begun writing meeting links.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

delete from public.app_record_links where meeting_id is not null;
alter policy record_links_owner_all on public.app_record_links
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (project_id is null or private.app_space_in_workspace(project_id, workspace_id))
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_record_links.workspace_id))
    and (note_id is null or exists (
      select 1 from public.app_notes n
      where n.id = note_id and n.workspace_id = app_record_links.workspace_id
        and private.app_is_workspace_owner(n.workspace_id)))
  );
alter table public.app_record_links
  add constraint app_record_links_one_target_original
    check (num_nonnulls(project_id, organization_id) = 1),
  add constraint app_record_links_unique_original
    unique nulls not distinct (google_task_id, note_id, project_id, organization_id);
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique;
alter table public.app_record_links
  rename constraint app_record_links_one_target_original to app_record_links_one_target;
alter table public.app_record_links
  rename constraint app_record_links_unique_original to app_record_links_unique;
drop index public.app_record_links_meeting_idx;
alter table public.app_record_links drop column meeting_id;
delete from supabase_migrations.schema_migrations
where version = '20260928123601' and name = 'task_meeting_followup_record_links';
commit;
