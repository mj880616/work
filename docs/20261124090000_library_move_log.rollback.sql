begin;
-- 20261124090000_library_move_log의 짝 되돌리기. 새 표 1개(색인·정책 포함)와 이번 기록 1행만 지운다. 남아 있던 옮긴 기록도 함께 사라진다.
-- 자료(app_documents)·폴더(app_library_folders)·폴더 연결(app_library_folder_items)은 건드리지 않는다.
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌려도 되고 그대로 두어도 된다(새 화면은 표가 없으면 기록 없이 옮기고 [지난 정돈 되돌리기]를 보이지 않는다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261124090000' and name = 'library_move_log') <> 1 then
    raise exception 'LIBRARY_MOVE_LOG_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_library_move_log;

delete from supabase_migrations.schema_migrations
  where version = '20261124090000' and name = 'library_move_log';
commit;
