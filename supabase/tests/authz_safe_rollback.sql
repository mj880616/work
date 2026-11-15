-- Run after the security-preserving project rollback in disposable local DB.
begin;
do $check$
begin
  if pg_catalog.has_function_privilege('anon','public.app_public_project(text)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','public.app_set_project_publication(uuid,boolean,boolean,text)','EXECUTE')
     or not pg_catalog.has_function_privilege('anon','public.app_public_post(text)','EXECUTE')
     or pg_catalog.to_regclass('public.app_project_publications') is null
     or pg_catalog.to_regclass('public.app_project_public_blocks') is null then
    raise exception 'Project rollback left a public project path or lost publication data structures';
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
  if found_count <> 7 then raise exception 'Legacy public URL changed during safe rollback'; end if;
end
$check$;
reset role;
rollback;
