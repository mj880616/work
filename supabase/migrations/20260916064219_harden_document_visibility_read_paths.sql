-- Applied to Supabase project xmlkxfjeagycwttklxjw on 2026-09-16.
-- Centralize document read authorization so direct rows and AI side tables cannot bypass visibility.
-- There is currently no document-to-group relationship table, so `groups` is fail-closed to the uploader
-- until an explicit group relationship is introduced.

create or replace function private.app_can_view_document(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when d.visibility = 'workspace' then
        private.app_is_workspace_member(d.workspace_id)
        and (d.project_id is null or private.app_can_view_space(d.project_id))
      when d.visibility in ('private', 'groups') then
        d.uploaded_by = auth.uid()
      else false
    end
    from public.app_documents d
    where d.id = p_document
  ), false)
$$;

revoke all on function private.app_can_view_document(uuid) from public;
grant execute on function private.app_can_view_document(uuid) to authenticated, service_role;

alter policy app_documents_scoped_read on public.app_documents
using (private.app_can_view_document(id));

alter policy app_document_ai_index_read on public.app_document_ai_index
using (private.app_can_view_document(document_id));

alter policy app_document_chunks_read on public.app_document_chunks
using (private.app_can_view_document(document_id));
