-- Harden public/authenticated boundaries for Web2 public portal.
-- Public browsing is served through controlled SECURITY DEFINER snapshots;
-- direct access to internal workspace tables stays closed to anon.

alter table public.app_spaces
  alter column visibility set default 'team';

alter table public.app_documents
  drop constraint if exists app_documents_visibility_check;

alter table public.app_documents
  add constraint app_documents_visibility_check
  check (visibility = any (array['public'::text,'workspace'::text,'groups'::text,'private'::text]));

create or replace function private.app_can_view_document(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when d.visibility in ('public','workspace') then
        private.app_is_workspace_member(d.workspace_id)
        and (d.project_id is null or private.app_can_view_space(d.project_id))
      when d.visibility in ('private','groups') then
        d.uploaded_by = auth.uid()
      else false
    end
    from public.app_documents d
    where d.id = p_document
  ), false)
$$;

revoke all on function private.app_can_view_document(uuid) from public;
grant execute on function private.app_can_view_document(uuid) to authenticated, service_role;

alter policy app_spaces_scoped_read on public.app_spaces
using (
  owner_id = auth.uid()
  or (
    visibility in ('public','team')
    and private.app_is_workspace_member(workspace_id)
  )
  or exists (
    select 1
    from public.app_space_members sm
    where sm.project_id = app_spaces.id
      and sm.user_id = auth.uid()
  )
);

alter policy app_events_scoped_read on public.app_events to authenticated;
alter policy app_events_scoped_insert on public.app_events to authenticated;
alter policy app_events_scoped_update on public.app_events to authenticated;
alter policy app_events_scoped_delete on public.app_events to authenticated;

-- The public portal never queries these internal tables directly.
-- Keep anon access on published pages only; the snapshot functions below
-- deliberately return a minimal public projection for projects/tasks/events/documents.
revoke all privileges on table
  public.app_spaces,
  public.app_tasks,
  public.app_events,
  public.app_documents
from anon;

-- RLS governs row DML for signed-in users. These table-level privileges are
-- not required by the client and bypass row semantics where applicable.
revoke truncate, references, trigger on table
  public.app_spaces,
  public.app_tasks,
  public.app_events,
  public.app_documents
from authenticated;

create or replace function public.app_public_projects_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with ws as (
  select id from public.app_workspaces where slug='kptu-work' limit 1
), spaces as (
  select s.id,s.parent_id,s.slug,s.name,s.description,s.status,s.sort_order,s.updated_at,
         s.project_type,s.start_on,s.end_on,s.current_phase
  from public.app_spaces s join ws on ws.id=s.workspace_id
  where s.visibility='public' and coalesce(s.status,'active') <> 'archived'
), ids as (
  select id from spaces
)
select jsonb_build_object(
  'spaces', coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'parent_id',s.parent_id,'slug',s.slug,'name',s.name,'description',s.description,
    'status',s.status,'sort_order',s.sort_order,'updated_at',s.updated_at,
    'project_type',s.project_type,'start_on',s.start_on,'end_on',s.end_on,'current_phase',s.current_phase
  ) order by s.sort_order nulls last,s.name) from spaces s),'[]'::jsonb),
  'tasks', coalesce((select jsonb_agg(jsonb_build_object(
    'id',t.id,'project_id',t.project_id,'title',t.title,'status',t.status,'priority',t.priority,
    'due_at',t.due_at,'completed_at',t.completed_at
  ) order by t.due_at nulls last,t.created_at desc)
  from public.app_tasks t where t.project_id in (select id from ids)),'[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'title',e.title,'event_type',e.event_type,'start_at',e.start_at,'end_at',e.end_at
  ) order by e.start_at,e.created_at)
  from public.app_events e join ws on ws.id=e.workspace_id
  where e.calendar_scope='team'),'[]'::jsonb),
  'pages', coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'space_id',p.space_id,'slug',p.slug,'title',p.title,'summary',p.summary,
    'published_at',p.published_at,'updated_at',p.updated_at
  ) order by p.published_at desc nulls last,p.updated_at desc)
  from public.app_pages p join ws on ws.id=p.workspace_id
  where p.status='published' and p.visibility='public'),'[]'::jsonb),
  'documents', coalesce((select jsonb_agg(jsonb_build_object(
    'id',d.id,'project_id',d.project_id,'title',d.title,'category',d.category,'source',d.source,
    'document_date',d.document_date,'description',d.description,'tags',d.tags,'drive_url',d.drive_url,
    'file_name',d.file_name,'updated_at',d.updated_at
  ) order by d.document_date desc nulls last,d.created_at desc)
  from public.app_documents d join ws on ws.id=d.workspace_id
  where d.visibility='public'),'[]'::jsonb),
  'project_updates','[]'::jsonb,
  'milestones','[]'::jsonb
)
$$;

revoke all on function public.app_public_projects_snapshot() from public;
grant execute on function public.app_public_projects_snapshot() to anon, authenticated, service_role;

create or replace function public.app_public_workspace_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with ws as (
  select id,slug,name from public.app_workspaces where slug='kptu-work' limit 1
), snap as (
  select public.app_public_projects_snapshot() as j
)
select jsonb_build_object(
  'workspace',coalesce((select to_jsonb(x) from (select id,slug,name from ws) x),'{}'::jsonb),
  'spaces',coalesce((select j->'spaces' from snap),'[]'::jsonb),
  'tasks',coalesce((select j->'tasks' from snap),'[]'::jsonb),
  'pages',coalesce((select j->'pages' from snap),'[]'::jsonb),
  'project_updates','[]'::jsonb,
  'milestones','[]'::jsonb,
  'events',coalesce((select j->'events' from snap),'[]'::jsonb),
  'meetings','[]'::jsonb,
  'documents',coalesce((select j->'documents' from snap),'[]'::jsonb),
  'suborganizations','[]'::jsonb,
  'suborganization_updates','[]'::jsonb
)
$$;

revoke all on function public.app_public_workspace_snapshot() from public;
grant execute on function public.app_public_workspace_snapshot() to anon, authenticated, service_role;
