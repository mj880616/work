begin;
-- 20261126150000_library_item_moved_at의 짝 되돌리기(SQL Editor 새 쿼리 창에서 실행 — 폰 경로 C 가능).
-- 트리거·그 함수·옮긴 시각 칸을 지우고 이번 기록 1행만 지운다. 자료·폴더 연결 값(folder_id 등)은 건드리지 않는다.
-- 서버(library-files drive-auto)는 칸이 없으면 드라이브 위치 따라가기만 쉬고 나머지는 지금처럼 동작한다. 표 권한·정책에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folder_items in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126150000' and name = 'library_item_moved_at') <> 1 then
    raise exception 'LIBRARY_ITEM_MOVED_AT_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger app_library_folder_items_moved_at on public.app_library_folder_items;
drop function private.app_library_folder_items_moved_at();
alter table public.app_library_folder_items drop column moved_at;

delete from supabase_migrations.schema_migrations where version = '20261126150000' and name = 'library_item_moved_at';
commit;
