begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Restore the exact production definition and EXECUTE state captured before
-- Web1-4 (see scripts/sql/snapshots/20260926004103_web1_4_drop_app_delete_pages.sql):
-- owner postgres, SECURITY DEFINER, search_path pg_catalog, public, private,
-- EXECUTE for postgres, authenticated, service_role only.
create or replace function public.app_delete_pages(p_page_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  requested_count integer;
  existing_count integer;
  deleted_count integer;
begin
  if p_page_ids is null or cardinality(p_page_ids)=0 then return 0; end if;
  select count(distinct x) into requested_count from unnest(p_page_ids) x;
  select count(*) into existing_count from public.app_pages p where p.id=any(p_page_ids);
  if existing_count <> requested_count then raise exception '삭제할 페이지를 찾을 수 없습니다.'; end if;
  if exists (
    select 1 from public.app_pages p
    where p.id=any(p_page_ids)
      and not private.app_is_workspace_owner(p.workspace_id)
  ) then
    raise exception '삭제 권한이 없는 페이지가 포함되어 있습니다.' using errcode='42501';
  end if;
  delete from public.app_pages p where p.id=any(p_page_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$function$;

-- The schema default privileges also grant new functions to anon; production
-- never had that grant on this function.
revoke all on function public.app_delete_pages(uuid[]) from PUBLIC, anon;
grant execute on function public.app_delete_pages(uuid[]) to authenticated, service_role;

commit;
