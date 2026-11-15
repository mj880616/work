-- Additive phase: narrow public reader before changing clients or anon grants.
-- Public library records are read in place. No duplicate app_pages are created.
create or replace function public.app_public_post(p_slug text)
returns table (
  id uuid,
  title text,
  summary text,
  body text,
  page_design jsonb,
  updated_at timestamptz,
  indexable boolean,
  document_category text,
  document_date date,
  document_source text,
  document_tags text[],
  document_url text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select p.id, p.title, p.summary, p.body,
         coalesce(p.metadata -> 'page_design', '{}'::jsonb), p.updated_at,
         (p.visibility = 'public'),
         null::text, null::date, null::text, null::text[], null::text
  from public.app_pages p
  where p_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'
    and p.slug = p_slug
    and p.slug not like 'public-doc-%'
    and p.workspace_id = (select w.id from public.app_workspaces w where w.slug='kptu-work' limit 1)
    and p.status = 'published'
    and (
      p.visibility = 'public'
      or (p.visibility = 'unlisted' and p.slug in (
        'bus-strike-publicness-internal-archive-202609',
        'gimpo-publicization',
        'gimpo-publicization-audit',
        'gimpo-publicization-press-1008',
        'line9-publicization',
        'line9-publicization-audit'
      ))
    )
  union all
  select d.id, d.title, d.description, ''::text, '{}'::jsonb, d.updated_at, true,
         d.category, d.document_date, d.source, d.tags, d.drive_url
  from public.app_documents d
  where p_slug ~ '^public-doc-[0-9a-f]{12}$'
    and p_slug = 'public-doc-' || left(replace(d.id::text, '-', ''), 12)
    and d.workspace_id = (select w.id from public.app_workspaces w where w.slug='kptu-work' limit 1)
    and d.visibility = 'public'
  limit 1
$function$;

revoke all on function public.app_public_post(text) from public;
grant execute on function public.app_public_post(text) to anon, authenticated;
