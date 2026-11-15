-- Web1-4 regression: the bulk page delete RPC is gone and the remaining page
-- entry points keep their grants. Catalog reads only; nothing is written.

begin;

do $$
begin
  if to_regprocedure('public.app_delete_pages(uuid[])') is not null then
    raise exception 'app_delete_pages still exists';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc ilike '%app_delete_pages%'
  ) then
    raise exception 'a function body still references app_delete_pages';
  end if;

  if not has_function_privilege('anon', 'public.app_public_post(text)', 'EXECUTE') then
    raise exception 'Web1 app_public_post grant regressed';
  end if;

  if not has_function_privilege('authenticated', 'public.app_can_edit_page_rpc(uuid)', 'EXECUTE') then
    raise exception 'public-page-edit permission RPC grant regressed';
  end if;
end
$$;

rollback;
