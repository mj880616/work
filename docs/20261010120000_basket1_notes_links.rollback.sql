begin;
-- Immediate unused-schema rollback only; never delete basket data to make this pass.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes, public.app_record_links in access exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261010120000' and name = 'basket1_notes_links') <> 1 then
    raise exception 'BASKET-1 rollback blocked: migration record differs';
  end if;
  if exists (select 1 from public.app_record_links where document_id is not null)
     or exists (select 1 from public.app_notes
       where attachments <> '[]'::jsonb or metadata <> '{}'::jsonb
          or archived_at is not null or ai_export_allowed <> true
          or length(raw_text) not between 1 and 20000) then
    raise exception 'BASKET-1 rollback blocked: new columns contain data; preserve/export and plan recovery';
  end if;
end
$$;
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
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique,
  add constraint app_record_links_one_target check (num_nonnulls(project_id, organization_id, meeting_id) = 1),
  add constraint app_record_links_unique unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id);
drop index public.app_record_links_document_idx;
alter table public.app_record_links drop column document_id;
alter table public.app_notes
  drop constraint app_notes_raw_text_check,
  drop constraint app_notes_attachments_check,
  drop constraint app_notes_metadata_check,
  drop column attachments,
  drop column archived_at,
  drop column ai_export_allowed,
  drop column metadata,
  add constraint app_notes_raw_text_check check (length(raw_text) between 1 and 20000);
delete from supabase_migrations.schema_migrations
  where version = '20261010120000' and name = 'basket1_notes_links';
commit;
