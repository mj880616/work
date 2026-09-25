begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Task 13 retires Web2 public/share RPC entry points without dropping their
-- definitions or tables. Web1's app_public_post() boundary is intentionally
-- outside this migration.
revoke execute on function public.app_public_workspace_index() from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_public_workspace_snapshot() from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_public_projects_snapshot() from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_public_project(text) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_public_suborganization_facets() from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_project_publication_state(uuid) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_set_project_publication(uuid,boolean,boolean,text) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_move_project_public_block(uuid,integer) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_create_share_link(uuid,timestamptz) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_open_share(text) from PUBLIC, anon, authenticated, service_role;
revoke execute on function public.app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text) from PUBLIC, anon, authenticated, service_role;

-- Existing public/unlisted/workspace/group rows are retained for Web1 and
-- later data cleanup. Only new Web2/authenticated visibility changes are
-- constrained; metadata-only updates to retained rows continue to work.
create or replace function private.app_enforce_web2_private_visibility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' and new.visibility is distinct from 'private' then
    raise exception 'Web2 can create only private content.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and new.visibility is distinct from old.visibility
     and new.visibility is distinct from 'private' then
    raise exception 'Web2 visibility can only be changed to private.' using errcode = '42501';
  end if;

  return new;
end
$$;

revoke all on function private.app_enforce_web2_private_visibility() from PUBLIC, anon, authenticated, service_role;

create trigger task13_pages_private_visibility
before insert or update of visibility on public.app_pages
for each row execute function private.app_enforce_web2_private_visibility();

create trigger task13_documents_private_visibility
before insert or update of visibility on public.app_documents
for each row execute function private.app_enforce_web2_private_visibility();

commit;
