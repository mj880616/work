-- TASK-29 permission-only recovery proposal. Do not run as part of TASK-29 application.
-- No backup exists: this cannot restore any deleted app_tasks row.
-- The pre-migration snapshot grants authenticated INSERT/UPDATE/DELETE/SELECT;
-- anon has no SELECT or write privilege. Restore only the withdrawn authenticated rights.
-- Any future execution requires a separate approval and current privilege review.
begin;
grant insert, update, delete on table public.app_tasks to authenticated;
commit;
