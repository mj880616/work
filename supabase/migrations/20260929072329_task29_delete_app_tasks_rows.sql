-- TASK-29: delete only the 58 previously audited legacy Web2 task rows.
-- This is intentionally irreversible: the owner chose no row backup.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_tasks in access exclusive mode;

do $$
declare
  v_total bigint;
  v_not_done bigint;
  v_missing_timestamps bigint;
  v_recent bigint;
  v_deleted bigint;
begin
  select count(*),
         count(*) filter (where status is distinct from 'done'),
         count(*) filter (where updated_at is null or completed_at is null),
         count(*) filter (where updated_at >= timestamptz '2026-09-28 00:00:00+09'
                             or completed_at >= timestamptz '2026-09-28 00:00:00+09')
    into v_total, v_not_done, v_missing_timestamps, v_recent
    from public.app_tasks;

  if v_total <> 58 or v_not_done <> 0 or v_missing_timestamps <> 0 or v_recent <> 0 then
    raise exception 'TASK-29 precondition failed: total %, not_done %, missing_timestamps %, recent %',
      v_total, v_not_done, v_missing_timestamps, v_recent;
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations
             where version = '20260929072329') then
    raise exception 'TASK-29 migration version already recorded';
  end if;

  delete from public.app_tasks;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 58 then
    raise exception 'TASK-29 deleted % rows instead of 58', v_deleted;
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260929072329', 'task29_delete_app_tasks_rows',
        array['TASK-29: delete 58 completed legacy app_tasks rows only']);
commit;
