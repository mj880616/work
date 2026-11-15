begin;
-- 20261101180000_todo_feedback의 짝 되돌리기. 새 표 2개(색인·정책 포함)를 지우고, 후보 상태 검사식을 원래 3개 상태로 돌리고, 기록 1행을 지운다.
-- '이미 함'(done) 후보는 검사식을 돌리기 전에 '무시'(dismissed)로 바꾼다(처리한 때는 그대로, 할 일은 만들지 않음).
-- 지우면 결과 기록(할 일로·이미 함·무시·내 일 아님)과 챙길 것 규칙(후보·확정·뺀 것)이 사라진다. 후보·할 일·[내 일 아님] 예시 표는 그대로다.
-- 지우기 전에 ai-assist·화면을 이전 판으로 되돌린다(이전 판은 이 표와 done 상태를 쓰지 않는다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_todo_candidates in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101180000' and name = 'todo_feedback') <> 1 then
    raise exception 'TODO_FEEDBACK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_todo_rules;
drop table public.app_todo_feedback;
update public.app_todo_candidates set status = 'dismissed' where status = 'done';
alter table public.app_todo_candidates drop constraint app_todo_candidates_status_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_status_check check (
  status in ('open', 'tasked', 'dismissed'));

delete from supabase_migrations.schema_migrations
  where version = '20261101180000' and name = 'todo_feedback';
commit;
