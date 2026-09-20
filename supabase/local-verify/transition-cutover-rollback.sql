-- Disposable CI assertion for the cutover-only fallback. Do not restore
-- legacy table grants or remove the additive project publication API.
begin;
do $check$
begin
  if not pg_catalog.has_function_privilege('anon','public.app_public_post(text)','EXECUTE')
     or not pg_catalog.has_function_privilege('anon','public.app_public_project(text)','EXECUTE')
     or pg_catalog.has_table_privilege('anon','public.app_pages','SELECT')
     or pg_catalog.has_function_privilege('anon','public.app_open_share(text)','EXECUTE') then
    raise exception 'Cutover fallback changed a narrow reader or reopened legacy access';
  end if;
end
$check$;
set local role anon;
do $check$
declare found_count integer;
begin
  select count(*) into found_count from (values
    ('bus-strike-publicness-internal-archive-202609'),
    ('gimpo-publicization'),('gimpo-publicization-audit'),
    ('gimpo-publicization-press-1008'),('line9-publicization'),
    ('line9-publicization-audit'),('private-rail-forum-0929-prep')
  ) legacy(slug)
  cross join lateral public.app_public_post(legacy.slug) post;
  if found_count <> 7 or exists(select 1 from public.app_public_post('local-private-post')) then
    raise exception 'Cutover fallback changed public URL or private post access';
  end if;
end
$check$;
reset role;
rollback;
