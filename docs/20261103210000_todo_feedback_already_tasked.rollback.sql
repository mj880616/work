begin;
-- 20261103210000_todo_feedback_already_tasked의 짝 되돌리기. 결과 검사식을 already_tasked 없는 20261101180000 todo_feedback 모양(네 값)으로 되돌리고 이번 기록 1행만 지운다.
-- already_tasked 줄이 하나라도 있으면 멈춘다(값을 지워서 통과시키지 않는다 — 먼저 화면 PR을 이전 판으로 되돌리고, 그 줄을 어떻게 할지 정한 뒤 다시 계획한다).
-- 표 권한·정책·함수·후보 표에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_todo_feedback in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261103210000' and name = 'todo_feedback_already_tasked') <> 1 then
    raise exception 'TODO_FEEDBACK_ALREADY_TASKED_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_todo_feedback where outcome = 'already_tasked') then
    raise exception 'TODO_FEEDBACK_ALREADY_TASKED_ROLLBACK_BLOCKED: already_tasked rows saved; decide them first';
  end if;
end
$$;

alter table public.app_todo_feedback drop constraint app_todo_feedback_outcome_check;
alter table public.app_todo_feedback add constraint app_todo_feedback_outcome_check check (
  outcome in ('tasked', 'done', 'dismissed', 'not_mine'));

delete from supabase_migrations.schema_migrations where version = '20261103210000' and name = 'todo_feedback_already_tasked';
commit;
