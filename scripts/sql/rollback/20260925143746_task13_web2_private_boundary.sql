begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop trigger if exists task13_pages_private_visibility on public.app_pages;
drop trigger if exists task13_documents_private_visibility on public.app_documents;
drop function if exists private.app_enforce_web2_private_visibility();

-- Restore the exact Gate 1 production EXECUTE state. Gate 3 must confirm that
-- this state has not drifted before this rollback is accepted for production.
revoke execute on function public.app_public_workspace_index() from PUBLIC, authenticated;
grant execute on function public.app_public_workspace_index() to anon, service_role;

revoke execute on function public.app_public_workspace_snapshot() from PUBLIC, anon, authenticated;
grant execute on function public.app_public_workspace_snapshot() to service_role;

revoke execute on function public.app_public_projects_snapshot() from PUBLIC, anon, authenticated;
grant execute on function public.app_public_projects_snapshot() to service_role;

revoke execute on function public.app_public_project(text) from PUBLIC, anon, authenticated;
grant execute on function public.app_public_project(text) to service_role;

revoke execute on function public.app_public_suborganization_facets() from PUBLIC, anon, authenticated;
grant execute on function public.app_public_suborganization_facets() to service_role;

revoke execute on function public.app_project_publication_state(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.app_project_publication_state(uuid) to service_role;

revoke execute on function public.app_set_project_publication(uuid,boolean,boolean,text) from PUBLIC, anon, authenticated;
grant execute on function public.app_set_project_publication(uuid,boolean,boolean,text) to service_role;

revoke execute on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) from PUBLIC, anon, authenticated;
grant execute on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) to service_role;

revoke execute on function public.app_move_project_public_block(uuid,integer) from PUBLIC, anon, authenticated;
grant execute on function public.app_move_project_public_block(uuid,integer) to service_role;

revoke execute on function public.app_create_share_link(uuid,timestamptz) from PUBLIC, anon, authenticated;
grant execute on function public.app_create_share_link(uuid,timestamptz) to service_role;

revoke execute on function public.app_open_share(text) from PUBLIC, anon;
grant execute on function public.app_open_share(text) to authenticated, service_role;

revoke execute on function public.app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text) from PUBLIC, anon;
grant execute on function public.app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text) to authenticated, service_role;

commit;
