-- Narrow anonymous index for the signed-out Web2 home.
-- It returns only explicitly public posts/documents and explicitly published projects.
-- Tasks and events are intentionally excluded.
create or replace function public.app_public_workspace_index() returns jsonb
language sql stable security definer set search_path=pg_catalog,public
as $function$
with ws as (
  select id from public.app_workspaces where slug='kptu-work' limit 1
)
select jsonb_build_object(
  'projects',coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug','project-'||replace(s.id::text,'-',''),
      'name',s.name,
      'description',coalesce(pp.public_summary,s.description),
      'status',s.status,
      'updated_at',s.updated_at
    ) order by s.sort_order nulls last,s.name)
    from public.app_spaces s
    join public.app_project_publications pp on pp.project_id=s.id and pp.published
    join ws on ws.id=s.workspace_id
    where s.status in ('active','done')
      and (s.metadata->>'project_system'='v2' or exists(
        select 1 from public.app_spaces parent
        where parent.id=s.parent_id and parent.metadata->>'project_system'='v2'
      ))
      and not s.is_legacy_snapshot
  ),'[]'::jsonb),
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

revoke all on function public.app_public_workspace_index() from public,anon,authenticated;
grant execute on function public.app_public_workspace_index() to anon;

-- Project detail remains the existing narrow, explicitly published project reader.
grant execute on function public.app_public_project(text) to anon;

-- Keep broad legacy snapshots closed to anonymous callers.
revoke execute on function public.app_public_projects_snapshot() from anon;
revoke execute on function public.app_public_workspace_snapshot() from anon;
