-- TASK-29 read-only verification after the owner applies the new migration in SQL Editor.
-- Compare the other table counts against the immediately preceding precheck snapshot.
select count(*) as task_rows,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929072329') as old_migration_records,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929081500'
           and name = 'task29_block_writes_delete_app_tasks_rows') as new_migration_records
from public.app_tasks;

select role_name,
       has_table_privilege(role_name, 'public.app_tasks', 'SELECT') as can_select,
       has_table_privilege(role_name, 'public.app_tasks', 'INSERT') as can_insert,
       has_table_privilege(role_name, 'public.app_tasks', 'UPDATE') as can_update,
       has_table_privilege(role_name, 'public.app_tasks', 'DELETE') as can_delete
from (values ('authenticated'), ('anon')) as roles(role_name)
order by role_name;

select 'app_meetings' as table_name, count(*) as row_count from public.app_meetings
union all select 'app_record_links', count(*) from public.app_record_links
union all select 'app_spaces', count(*) from public.app_spaces
union all select 'app_workspaces', count(*) from public.app_workspaces
union all select 'app_notes', count(*) from public.app_notes
order by table_name;
