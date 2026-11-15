-- Web2 projects are personal owner-only records.
-- Existing rows, legacy metadata, visibility values, memberships, and progress data are preserved.

create index if not exists app_spaces_owner_id_idx
  on public.app_spaces(owner_id);

create or replace function private.app_can_view_space(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $function$
  select coalesce((
    select s.owner_id = (select auth.uid())
    from public.app_spaces s
    where s.id=p_space
  ), false)
$function$;

create or replace function private.app_can_edit_space(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $function$
  select coalesce((
    select s.owner_id = (select auth.uid())
    from public.app_spaces s
    where s.id=p_space
  ), false)
$function$;

create or replace function private.app_can_manage_space(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $function$
  select coalesce((
    select s.owner_id = (select auth.uid())
    from public.app_spaces s
    where s.id=p_space
  ), false)
$function$;

drop policy if exists app_spaces_scoped_read on public.app_spaces;
create policy app_spaces_scoped_read
on public.app_spaces
for select
to authenticated
using (owner_id = (select auth.uid()));

-- Public workspace keeps public posts and public library documents, but no longer
-- advertises projects. Project publication records remain stored for rollback/audit.
create or replace function public.app_public_workspace_index()
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $function$
with ws as (
  select id from public.app_workspaces where slug='kptu-work' limit 1
)
select jsonb_build_object(
  'projects','[]'::jsonb,
  'pages',coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug',p.slug,'title',p.title,'summary',p.summary,
      'published_at',p.published_at,'updated_at',p.updated_at
    ) order by p.published_at desc nulls last,p.updated_at desc)
    from public.app_pages p
    join ws on ws.id=p.workspace_id
    where p.status='published' and p.visibility='public'
  ),'[]'::jsonb),
  'documents',coalesce((
    select jsonb_agg(jsonb_build_object(
      'title',d.title,'category',d.category,'source',d.source,
      'document_date',d.document_date,'description',d.description,
      'tags',d.tags,'drive_url',d.drive_url,'file_name',d.file_name,
      'updated_at',d.updated_at
    ) order by d.document_date desc nulls last,d.created_at desc)
    from public.app_documents d
    join ws on ws.id=d.workspace_id
    where d.visibility='public'
  ),'[]'::jsonb)
)
$function$;

-- Retire every project-publication execution path without deleting its data.
revoke execute on function public.app_public_project(text) from public,anon,authenticated;
revoke execute on function public.app_public_projects_snapshot() from public,anon,authenticated;
revoke execute on function public.app_project_publication_state(uuid) from public,anon,authenticated;
revoke execute on function public.app_set_project_publication(uuid,boolean,boolean,text) from public,anon,authenticated;
revoke execute on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) from public,anon,authenticated;
revoke execute on function public.app_move_project_public_block(uuid,integer) from public,anon,authenticated;

-- The public index remains the narrow anonymous entry point for posts/documents.
revoke execute on function public.app_public_workspace_index() from public;
grant execute on function public.app_public_workspace_index() to anon;
