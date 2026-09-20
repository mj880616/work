-- A/B compatibility: the currently deployed static shell reads app_pages directly.
-- This fixture runs only in the disposable local database.
begin;
create temp table legacy_result(slug text);
grant insert,select on legacy_result to anon;
set local role anon;
insert into legacy_result(slug)
select p.slug from public.app_pages p
where p.status='published' and p.visibility in ('public','unlisted')
  and p.slug in (
    'bus-strike-publicness-internal-archive-202609',
    'gimpo-publicization','gimpo-publicization-audit',
    'gimpo-publicization-press-1008','line9-publicization',
    'line9-publicization-audit','private-rail-forum-0929-prep'
  );
reset role;
do $check$
begin
  if (select count(*) from legacy_result) <> 7
     or (select count(distinct slug) from legacy_result) <> 7
     or not has_table_privilege('anon','public.app_pages','SELECT')
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid='public.app_pages'::regclass
         and p.polname='app_pages_public_read'
     ) then
    raise exception 'Current static public-page contract changed';
  end if;
end
$check$;
rollback;
