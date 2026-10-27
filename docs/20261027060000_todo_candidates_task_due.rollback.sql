begin;
-- 20261027060000_todo_candidates_task_due의 짝 되돌리기. task_due 칸·검사 제약과 이번 기록 1행만 지운다. 칸 권한은 칸과 함께 사라진다.
-- task_due에 값이 한 줄이라도 있으면 멈춘다. 값을 지워서 통과시키지 않는다(그 기한은 할 일 사본에서 다시 읽을 수 있지만 보관 여부는 사람이 정한다).
-- 그런 경우 먼저 화면을 이전 버전으로 되돌려 이 칸을 더 쓰지 않게 하고, 보관 여부를 정한 뒤 다시 계획한다.
-- 기존 표·정책·다른 칸에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_todo_candidates in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261027060000' and name = 'todo_candidates_task_due') <> 1 then
    raise exception 'TODO_TASK_DUE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_todo_candidates where task_due is not null) then
    raise exception 'TODO_TASK_DUE_ROLLBACK_BLOCKED: task_due values exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_todo_candidates drop constraint app_todo_candidates_task_due_check;
alter table public.app_todo_candidates drop column task_due;

delete from supabase_migrations.schema_migrations
  where version = '20261027060000' and name = 'todo_candidates_task_due';
commit;
