-- B/C compatibility: both new public RPCs exist before old anonymous access closes.
begin;
create temp table new_page_result(slug text);
grant insert,select on new_page_result to anon;
set local role anon;
insert into new_page_result(slug)
select legacy.slug from (values
  ('bus-strike-publicness-internal-archive-202609'),
  ('gimpo-publicization'),('gimpo-publicization-audit'),
  ('gimpo-publicization-press-1008'),('line9-publicization'),
  ('line9-publicization-audit'),('private-rail-forum-0929-prep')
) legacy(slug)
cross join lateral public.app_public_post(legacy.slug) post;
reset role;
do $check$
begin
  if (select count(*) from new_page_result) <> 7
     or (select count(distinct slug) from new_page_result) <> 7
     or not has_function_privilege('anon','public.app_public_post(text)','EXECUTE')
     or not has_function_privilege('anon','public.app_public_project(text)','EXECUTE')
     or public.app_public_project('project-90000000000040008000000000000020') is not null
     or exists (select 1 from public.app_public_post('local-private-post')) then
    raise exception 'Additive public API contract failed';
  end if;
end
$check$;
rollback;
