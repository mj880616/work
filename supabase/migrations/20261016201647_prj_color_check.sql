begin;
-- PRJ-색: reuse the existing app_spaces.metadata jsonb. Only an allow-list CHECK for metadata.color.
-- No new column, no RLS/policy/grant change, no data change.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_spaces in access exclusive mode;
do $$
begin
  if not exists (select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='metadata' and atttypid='jsonb'::regtype and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname='app_spaces_metadata_color_check')
     or exists (select 1 from pg_class where oid=to_regclass('public.app_spaces') and not relrowsecurity)
     or exists (select 1 from public.app_spaces where metadata ? 'color'
       and metadata->'color' not in ('"green"'::jsonb,'"blue"'::jsonb,'"orange"'::jsonb,'"purple"'::jsonb,'"pink"'::jsonb,'"yellow"'::jsonb,'"red"'::jsonb,'"gray"'::jsonb)) then
    raise exception 'PRJ-COLOR prerequisite differs; stop';
  end if;
end
$$;
-- A non-object metadata (null, array, scalar) carries no color key and stays valid as before.
alter table public.app_spaces add constraint app_spaces_metadata_color_check check (
  jsonb_typeof(metadata) is distinct from 'object'
  or not (metadata ? 'color')
  or metadata->'color' in ('"green"'::jsonb,'"blue"'::jsonb,'"orange"'::jsonb,'"purple"'::jsonb,'"pink"'::jsonb,'"yellow"'::jsonb,'"red"'::jsonb,'"gray"'::jsonb)
);
insert into supabase_migrations.schema_migrations (version,name,statements)
values ('20261016201647','prj_color_check',array['PRJ-색: app_spaces metadata.color accepts only 8 color keys']);
commit;
