begin;
-- 20261102030000_todo_feature_guard의 짝 되돌리기(SQL Editor 경로 전용: 트리거·정책 삭제가 들어 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 순서: 트리거 2개 삭제 → 읽기 정책 2개 삭제 → 기록 1행 삭제.
-- 챙길 것 표의 줄·칸·기존 정책·권한·기존 트리거와 재사용한 두 함수는 건드리지 않는다. 되돌린 뒤에는 이 migration 전처럼 작업공간 owner면 텔레그램 방·텔레그램 후보를 읽고 넣는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261102030000' and name = 'todo_feature_guard') <> 1 then
    raise exception 'TODO_FEATURE_GUARD_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger trg_op_feature_guard on public.app_todo_ask_rooms;
drop trigger trg_op_feature_guard on public.app_todo_candidates;
drop policy op_feature_read on public.app_todo_ask_rooms;
drop policy op_feature_read on public.app_todo_candidates;

delete from supabase_migrations.schema_migrations where version = '20261102030000' and name = 'todo_feature_guard';
commit;
