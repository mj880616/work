-- TASK-29: revoke client writes and delete exactly the 63 audited legacy rows.
-- The unapplied 20260929072329 migration is superseded, not run first.
-- Row deletion is irreversible because the owner chose no backup.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_tasks in access exclusive mode;

revoke insert, update, delete on table public.app_tasks from anon, authenticated;

do $$
declare
  v_total bigint;
  v_done bigint;
  v_not_done bigint;
  v_old_missing_timestamps bigint;
  v_old_recent bigint;
  v_new_mismatch bigint;
  v_after_cutoff bigint;
  v_deleted bigint;
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in ('20260929072329', '20260929081500')
  ) then
    raise exception 'TASK-29 old or new migration version already recorded';
  end if;

  if not has_table_privilege('authenticated', 'public.app_tasks', 'SELECT')
     or has_table_privilege('anon', 'public.app_tasks', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_tasks', 'INSERT')
     or has_table_privilege('authenticated', 'public.app_tasks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.app_tasks', 'DELETE')
     or has_table_privilege('anon', 'public.app_tasks', 'INSERT')
     or has_table_privilege('anon', 'public.app_tasks', 'UPDATE')
     or has_table_privilege('anon', 'public.app_tasks', 'DELETE') then
    raise exception 'TASK-29 table privileges do not match the expected owner-only read and no-client-write boundary';
  end if;

  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status is distinct from 'done'),
         count(*) filter (where status = 'done'
                            and (updated_at is null or completed_at is null)),
         count(*) filter (where status = 'done'
                            and (updated_at >= timestamptz '2026-09-28 00:00:00+09'
                                 or completed_at >= timestamptz '2026-09-28 00:00:00+09')),
         count(*) filter (where status is distinct from 'done'
                            and (status = 'todo'
                                 and created_at >= timestamptz '2026-09-29 16:24:03+09'
                                 and created_at < timestamptz '2026-09-29 16:24:04+09'
                                 and updated_at >= timestamptz '2026-09-29 16:24:03+09'
                                 and updated_at < timestamptz '2026-09-29 16:24:04+09'
                                 and completed_at is null) is not true),
         count(*) filter (where created_at >= timestamptz '2026-09-29 16:25:00+09'
                            or updated_at >= timestamptz '2026-09-29 16:25:00+09'
                            or completed_at >= timestamptz '2026-09-29 16:25:00+09')
    into v_total, v_done, v_not_done, v_old_missing_timestamps,
         v_old_recent, v_new_mismatch, v_after_cutoff
    from public.app_tasks;

  if v_total <> 63 or v_done <> 58 or v_not_done <> 5
     or v_old_missing_timestamps <> 0 or v_old_recent <> 0
     or v_new_mismatch <> 0 or v_after_cutoff <> 0 then
    raise exception 'TASK-29 precondition failed: total %, done %, not_done %, old_missing %, old_recent %, new_mismatch %, after_cutoff %',
      v_total, v_done, v_not_done, v_old_missing_timestamps,
      v_old_recent, v_new_mismatch, v_after_cutoff;
  end if;

  delete from public.app_tasks;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 63 then
    raise exception 'TASK-29 deleted % rows instead of 63', v_deleted;
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260929081500', 'task29_block_writes_delete_app_tasks_rows',
        array['TASK-29: revoke anon/authenticated writes and delete 63 audited legacy app_tasks rows']);
commit;
