begin;
-- BASKET-1, schema only. Phone path C: docs/basket-1-apply.md.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes, public.app_record_links in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20260927103344' and name = 'task_impl2_notes_record_links') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
      where version = '20260928123601' and name = 'task_meeting_followup_record_links') <> 1 then
    raise exception 'BASKET-1 prerequisite migration records differ; stop';
  end if;
  if exists (select 1 from public.app_notes where length(raw_text) not between 1 and 20000)
     or exists (select 1 from public.app_record_links
                where num_nonnulls(project_id, organization_id, meeting_id) <> 1) then
    raise exception 'BASKET-1 existing content/target violations; stop';
  end if;
end
$$;

alter table public.app_notes
  add column attachments jsonb not null default '[]'::jsonb,
  add column archived_at timestamptz,
  add column ai_export_allowed boolean not null default true,
  add column metadata jsonb not null default '{}'::jsonb;
-- Technical first-version cap: 20 attachments/note, 100 MiB/file.
-- No helper function or new grants. Drive existence/ownership/deduplication is server work.
alter table public.app_notes
  add constraint app_notes_attachments_check check (
    case when jsonb_typeof(attachments) = 'array' then
      jsonb_array_length(attachments) <= 20
      -- Strict top-level item check prevents lax auto-unwrapping nested arrays.
      and not jsonb_path_exists(attachments, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(attachments, '$[*] ? (
        @.type() != "object"
        || !exists(@.drive_file_id) || !exists(@.file_name)
        || !exists(@.mime_type) || !exists(@.size_bytes)
        || @.drive_file_id.type() != "string"
        || !(@.drive_file_id like_regex "^[A-Za-z0-9_-]{1,255}$")
        || @.file_name.type() != "string"
        || !(@.file_name like_regex "^.{1,255}$" flag "s")
        || @.mime_type.type() != "string"
        || !(@.mime_type like_regex "^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$")
        || @.size_bytes.type() != "number"
        || @.size_bytes < 1 || @.size_bytes > 104857600
        || @.size_bytes != @.size_bytes.floor()
      )')
      and not jsonb_path_exists(attachments, '$[*].keyvalue() ? (
        @.key != "drive_file_id" && @.key != "file_name"
        && @.key != "mime_type" && @.key != "size_bytes"
      )')
    else false end
  ),
  add constraint app_notes_metadata_check check (jsonb_typeof(metadata) = 'object'),
  add constraint app_notes_raw_text_basket_check check (
    length(raw_text) <= 20000
    and (length(raw_text) >= 1 or jsonb_array_length(attachments) >= 1)
  );
alter table public.app_notes drop constraint app_notes_raw_text_check;
alter table public.app_notes rename constraint app_notes_raw_text_basket_check to app_notes_raw_text_check;

alter table public.app_record_links
  add column document_id uuid references public.app_documents(id) on delete cascade,
  add constraint app_record_links_one_target_document
    check (num_nonnulls(project_id, organization_id, meeting_id, document_id) = 1),
  add constraint app_record_links_unique_document unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id, document_id);
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique;
alter table public.app_record_links rename constraint app_record_links_one_target_document to app_record_links_one_target;
alter table public.app_record_links rename constraint app_record_links_unique_document to app_record_links_unique;
create index app_record_links_document_idx on public.app_record_links(document_id) where document_id is not null;

-- Preserve USING, role list, source/task/status/report rules and all existing grants.
alter policy record_links_owner_all on public.app_record_links
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (project_id is null or private.app_space_in_workspace(project_id, workspace_id))
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_record_links.workspace_id))
    and (meeting_id is null or private.app_meeting_in_workspace(meeting_id, workspace_id))
    and (document_id is null or exists (
      select 1 from public.app_documents d
      where d.id = document_id and d.workspace_id = app_record_links.workspace_id
        and private.app_is_workspace_owner(d.workspace_id)))
    and (note_id is null or exists (
      select 1 from public.app_notes n
      where n.id = note_id and n.workspace_id = app_record_links.workspace_id
        and private.app_is_workspace_owner(n.workspace_id)))
  );

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261010120000', 'basket1_notes_links', array['BASKET-1: notes attachments/archive/export/metadata and document target']);
commit;
