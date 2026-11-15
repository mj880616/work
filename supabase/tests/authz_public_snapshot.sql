-- Authorization regression for the final public single-post boundary.
-- Run only against the local synthetic seed after both 20260920 public-post migrations.
begin;

create temp table authz_public_post_result(phase text, payload jsonb);
grant select,insert on authz_public_post_result to anon;
create temp table authz_legacy_url_result(slug text, payload jsonb);
grant select,insert on authz_legacy_url_result to anon;
create temp table authz_document_url_result(slug text, payload jsonb);
grant select,insert on authz_document_url_result to anon;

do $block$
declare
  wid uuid;
  uid uuid;
begin
  select id into wid from public.app_workspaces where slug='kptu-work' limit 1;
  select m.user_id into uid from public.app_workspace_members m
    where m.workspace_id=wid order by m.created_at limit 1;
  if wid is null or uid is null then raise exception 'Public-post fixture needs a workspace member'; end if;
  insert into public.app_pages(
    workspace_id,slug,title,summary,body,content_format,visibility,status,owner_id
  ) values
    (wid,'authz-public-post-fixture','PUBLIC FIXTURE','safe summary','PUBLIC BODY','markdown','public','published',uid),
    (wid,'authz-private-post-fixture','PRIVATE FIXTURE','private summary','PRIVATE BODY','markdown','private','published',uid);
end
$block$;

set local role anon;
insert into authz_public_post_result
select 'initial',to_jsonb(x) from public.app_public_post('authz-public-post-fixture') x;
insert into authz_public_post_result
select 'private',to_jsonb(x) from public.app_public_post('authz-private-post-fixture') x;
insert into authz_legacy_url_result
select legacy.slug,to_jsonb(post)
from (values
  ('bus-strike-publicness-internal-archive-202609'),
  ('gimpo-publicization'),
  ('gimpo-publicization-audit'),
  ('gimpo-publicization-press-1008'),
  ('line9-publicization'),
  ('line9-publicization-audit'),
  ('private-rail-forum-0929-prep')
) as legacy(slug)
cross join lateral public.app_public_post(legacy.slug) post;
insert into authz_document_url_result
select doc.slug,to_jsonb(post)
from (select 'public-doc-90000000'||lpad(n::text,4,'0') as slug
      from generate_series(100,113) n) doc
cross join lateral public.app_public_post(doc.slug) post;
reset role;

do $block$
begin
  if (select count(*) from authz_public_post_result where phase='initial') <> 1
     or (select count(*) from authz_public_post_result where phase='private') <> 0 then
    raise exception 'Public/private single-post filtering failed';
  end if;
  if (select count(*) from authz_legacy_url_result) <> 7
     or (select count(distinct slug) from authz_legacy_url_result) <> 7
     or (select count(*) from authz_legacy_url_result
         where slug='private-rail-forum-0929-prep' and payload->>'indexable'='true') <> 1
     or (select count(*) from authz_legacy_url_result
         where slug<>'private-rail-forum-0929-prep' and payload->>'indexable'='false') <> 6 then
    raise exception 'Seven legacy public URLs or indexability changed';
  end if;
  if (select count(*) from authz_document_url_result) <> 14
     or (select count(distinct slug) from authz_document_url_result) <> 14 then
    raise exception 'Fourteen public document URLs changed';
  end if;
  if exists (
    select 1 from (
      select payload from authz_public_post_result
      union all select payload from authz_legacy_url_result
      union all select payload from authz_document_url_result
    ) result
    where payload ?| array['workspace_id','owner_id','metadata','space_id','workstream_id']
  ) then
    raise exception 'Public response includes internal columns';
  end if;
  if not has_function_privilege('anon','public.app_public_post(text)','EXECUTE')
     or has_function_privilege('anon','public.app_public_projects_snapshot()','EXECUTE')
     or has_function_privilege('anon','public.app_public_workspace_snapshot()','EXECUTE')
     or has_function_privilege('anon','public.app_open_share(text)','EXECUTE') then
    raise exception 'Anonymous function grants are too broad';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and c.relname like 'app\_%' escape '\'
      and has_table_privilege('anon',c.oid,'SELECT')
  ) then
    raise exception 'Anonymous direct app-table SELECT remains';
  end if;
end
$block$;

update public.app_pages set visibility='private' where slug='authz-public-post-fixture';
update public.app_pages set visibility='public' where slug='authz-private-post-fixture';

set local role anon;
insert into authz_public_post_result
select 'revoked',to_jsonb(x) from public.app_public_post('authz-public-post-fixture') x;
insert into authz_public_post_result
select 'published',to_jsonb(x) from public.app_public_post('authz-private-post-fixture') x;
reset role;

do $block$
begin
  if (select count(*) from authz_public_post_result where phase='revoked') <> 0
     or (select count(*) from authz_public_post_result where phase='published') <> 1 then
    raise exception 'Visibility transitions are not immediate';
  end if;
end
$block$;

rollback;
