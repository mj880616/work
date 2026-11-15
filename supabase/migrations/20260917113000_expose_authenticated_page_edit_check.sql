create or replace function public.app_can_edit_page_rpc(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.app_can_edit_page(p_page)
$$;

revoke all on function public.app_can_edit_page_rpc(uuid) from public;
revoke all on function public.app_can_edit_page_rpc(uuid) from anon;
grant execute on function public.app_can_edit_page_rpc(uuid) to authenticated;
