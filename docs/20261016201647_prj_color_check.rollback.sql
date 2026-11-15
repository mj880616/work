begin;
-- Removes only the allow-list CHECK. Stored color keys stay in metadata (the screen keeps showing them).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_spaces in access exclusive mode;
alter table public.app_spaces drop constraint app_spaces_metadata_color_check;
delete from supabase_migrations.schema_migrations where version='20261016201647' and name='prj_color_check';
commit;
