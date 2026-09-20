-- Apply only after all seven legacy URLs, Web1's 14 existing documents, and the Pages
-- metadata sync are serving through app_public_post.
do $block$
declare
  doc_count integer;
  custom_count integer;
begin
  select count(*) into doc_count
  from public.app_documents d
  where d.visibility='public'
    and d.workspace_id=(select id from public.app_workspaces where slug='kptu-work' limit 1);
  if doc_count <> 14 then
    raise exception 'Expected 14 public legacy documents, found %', doc_count;
  end if;

  if (select count(distinct 'public-doc-' || left(replace(d.id::text,'-',''),12))
      from public.app_documents d
      where d.visibility='public'
        and d.workspace_id=(select id from public.app_workspaces where slug='kptu-work' limit 1)) <> doc_count then
    raise exception 'Public document slug collision';
  end if;
  select count(*) into custom_count
  from public.app_pages p
  where p.workspace_id=(select id from public.app_workspaces where slug='kptu-work' limit 1)
    and p.status='published' and p.visibility='unlisted'
    and p.slug in (
      'bus-strike-publicness-internal-archive-202609',
      'gimpo-publicization',
      'gimpo-publicization-audit',
      'gimpo-publicization-press-1008',
      'line9-publicization',
      'line9-publicization-audit'
    );
  if custom_count <> 6 then
    raise exception 'Expected six published legacy unlisted custom pages, found %', custom_count;
  end if;
  if (select count(*) from public.app_pages p
      where p.workspace_id=(select id from public.app_workspaces where slug='kptu-work' limit 1)
        and p.slug='private-rail-forum-0929-prep'
        and p.status='published' and p.visibility='public') <> 1 then
    raise exception 'Expected published public forum page; review cutover';
  end if;
end
$block$;

drop policy if exists app_pages_public_read on public.app_pages;
revoke execute on function public.app_open_share(text) from anon;
revoke execute on function public.app_create_share_link(uuid,timestamptz) from authenticated;
revoke execute on function public.app_public_projects_snapshot() from anon;
revoke execute on function public.app_public_workspace_snapshot() from anon;

-- No anonymous table workflow remains. RLS alone does not protect TRUNCATE.
do $block$
declare item record;
begin
  for item in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and c.relname like 'app\_%' escape '\'
  loop
    execute pg_catalog.format('revoke all privileges on table public.%I from anon',item.relname);
  end loop;
end
$block$;
