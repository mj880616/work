-- TASK-meeting-followup PR 1: allow one meeting as an app_record_links target.
-- Apply only after 20260927103344_task_impl2_notes_record_links.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

-- Existing project/organization rows must already satisfy the expanded rule.
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20260927103344' and name = 'task_impl2_notes_record_links') <> 1 then
    raise exception 'TASK-impl2 record-links migration is not recorded exactly once';
  end if;
  if exists (select 1 from public.app_record_links
             where num_nonnulls(project_id, organization_id) <> 1) then
    raise exception 'existing app_record_links rows violate one-target rule';
  end if;
end
$$;

alter table public.app_record_links
  add column meeting_id uuid references public.app_meetings(id) on delete cascade;

-- Install the replacements before removing the original constraints.
alter table public.app_record_links
  add constraint app_record_links_one_target_meeting
    check (num_nonnulls(project_id, organization_id, meeting_id) = 1),
  add constraint app_record_links_unique_meeting
    unique nulls not distinct (google_task_id, note_id, project_id, organization_id, meeting_id);
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique;
alter table public.app_record_links
  rename constraint app_record_links_one_target_meeting to app_record_links_one_target;
alter table public.app_record_links
  rename constraint app_record_links_unique_meeting to app_record_links_unique;
create index app_record_links_meeting_idx on public.app_record_links(meeting_id)
  where meeting_id is not null;

-- ALTER POLICY leaves the original owner-only USING expression unchanged.
alter policy record_links_owner_all on public.app_record_links
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (project_id is null or private.app_space_in_workspace(project_id, workspace_id))
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_record_links.workspace_id))
    and (meeting_id is null or private.app_meeting_in_workspace(meeting_id, workspace_id))
    and (note_id is null or exists (
      select 1 from public.app_notes n
      where n.id = note_id and n.workspace_id = app_record_links.workspace_id
        and private.app_is_workspace_owner(n.workspace_id)))
  );

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260928123601', 'task_meeting_followup_record_links',
        array['TASK-meeting-followup PR 1: meeting target for app_record_links']);
commit;
