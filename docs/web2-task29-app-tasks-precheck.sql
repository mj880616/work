-- TASK-29 read-only snapshot. Run in the approved local session immediately before SQL Editor application.
-- Do not select task text. Compare every value with docs/web2-task29-app-tasks-rows.md.
select count(*) as task_rows,
       count(*) filter (where status = 'done') as done_rows,
       count(*) filter (where status is distinct from 'done') as not_done_rows,
       count(*) filter (where status = 'done'
                          and (updated_at is null or completed_at is null)) as old_missing_timestamps,
       count(*) filter (where status = 'done'
                          and (updated_at >= timestamptz '2026-09-28 00:00:00+09'
                               or completed_at >= timestamptz '2026-09-28 00:00:00+09')) as old_recent_rows,
       count(*) filter (where status is distinct from 'done'
                          and (status = 'todo'
                               and created_at >= timestamptz '2026-09-29 16:24:03+09'
                               and created_at < timestamptz '2026-09-29 16:24:04+09'
                               and updated_at >= timestamptz '2026-09-29 16:24:03+09'
                               and updated_at < timestamptz '2026-09-29 16:24:04+09'
                               and completed_at is null) is not true) as new_cohort_mismatch,
       count(*) filter (where created_at >= timestamptz '2026-09-29 16:25:00+09'
                          or updated_at >= timestamptz '2026-09-29 16:25:00+09'
                          or completed_at >= timestamptz '2026-09-29 16:25:00+09') as after_cutoff_rows,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929072329') as old_migration_records,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929081500') as new_migration_records
from public.app_tasks;

select role_name,
       has_table_privilege(role_name, 'public.app_tasks', 'SELECT') as can_select,
       has_table_privilege(role_name, 'public.app_tasks', 'INSERT') as can_insert,
       has_table_privilege(role_name, 'public.app_tasks', 'UPDATE') as can_update,
       has_table_privilege(role_name, 'public.app_tasks', 'DELETE') as can_delete
from (values ('authenticated'), ('anon')) as roles(role_name)
order by role_name;

select policyname, cmd, roles
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'app_tasks'
order by policyname;

select tgname as trigger_name
from pg_catalog.pg_trigger
where tgrelid = 'public.app_tasks'::regclass and not tgisinternal
order by tgname;

select 'app_meetings' as table_name, count(*) as row_count from public.app_meetings
union all select 'app_record_links', count(*) from public.app_record_links
union all select 'app_spaces', count(*) from public.app_spaces
union all select 'app_workspaces', count(*) from public.app_workspaces
union all select 'app_notes', count(*) from public.app_notes
order by table_name;
