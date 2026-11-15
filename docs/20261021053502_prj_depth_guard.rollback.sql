begin;
-- Removes only the PRJ-3단 trigger, its function and the history row. No project row, column, policy or grant is touched.
-- After this the database accepts any depth again; the screen check (app/project-system-v3.js parentProblem) stays.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_spaces in share row exclusive mode;
drop trigger if exists app_spaces_depth_guard on public.app_spaces;
drop function if exists private.app_enforce_space_depth();
delete from supabase_migrations.schema_migrations where version = '20261021053502' and name = 'prj_depth_guard';
commit;
