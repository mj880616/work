-- Manual fallback for prepare ONLY before cutover is applied.
-- Keep the function definition and all content; withdraw its new API grant.
begin;
do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='app_pages' and p.polname='app_pages_public_read'
  ) then
    raise exception 'Prepare fallback refused: cutover has removed the legacy page policy';
  end if;
  if pg_catalog.to_regprocedure('public.app_public_post(text)') is null then
    raise exception 'Prepare fallback refused: public reader is absent';
  end if;
end
$guard$;
revoke execute on function public.app_public_post(text) from anon, authenticated;
commit;
