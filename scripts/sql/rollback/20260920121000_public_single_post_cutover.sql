-- Security-preserving cutover fallback. The broad old anon table policy/grants
-- must never be restored. Existing seven URLs continue through app_public_post.
-- Roll the client back to its compatible public-post reader separately.
begin;
do $guard$
begin
  if pg_catalog.to_regprocedure('public.app_public_post(text)') is null then
    raise exception 'Cutover fallback refused: narrow public reader is absent';
  end if;
end
$guard$;
revoke execute on function public.app_open_share(text) from anon;
revoke execute on function public.app_public_projects_snapshot() from anon;
revoke execute on function public.app_public_workspace_snapshot() from anon;
grant execute on function public.app_public_post(text) to anon, authenticated;
commit;
