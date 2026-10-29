begin;
-- 20261029210000_todo_mine_only의 짝 되돌리기. 함수 1개, 새 표 2개(색인·정책 포함), 이번 기록 1행만 지운다.
-- 지우면 '전체 부탁도 올릴 방' 목록과 [내 일 아님] 예시가 사라진다. 챙길 것 후보(app_todo_candidates)·텔레그램 소식은 그대로다.
-- 지우기 전에 collector-feed·ai-assist·화면을 이전 판으로 되돌린다(이전 판은 이 표·함수를 쓰지 않는다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029210000' and name = 'todo_mine_only') <> 1 then
    raise exception 'TODO_MINE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_todo_ask_filter(uuid, text);
drop table public.app_todo_not_mine;
drop table public.app_todo_ask_rooms;

delete from supabase_migrations.schema_migrations
  where version = '20261029210000' and name = 'todo_mine_only';
commit;
