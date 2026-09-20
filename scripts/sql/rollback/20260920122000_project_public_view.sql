-- Disable only new project publication API paths. Keep source projects,
-- publication choices, block IDs and relations for a later forward repair.
begin;
revoke all on function public.app_set_project_publication(uuid,boolean,boolean,text)
  from public, anon, authenticated;
revoke all on function public.app_set_project_block_publication(uuid,boolean,boolean,integer)
  from public, anon, authenticated;
revoke all on function public.app_public_project(text)
  from public, anon, authenticated;
revoke all on function public.app_project_publication_state(uuid)
  from public, anon, authenticated;
revoke all on function public.app_move_project_public_block(uuid,integer)
  from public, anon, authenticated;
revoke all on public.app_project_publications, public.app_project_public_blocks
  from public, anon, authenticated;
commit;
