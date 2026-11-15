begin;
-- 20261022120000_library_folders의 짝 되돌리기. 새 표 2개(정책·색인·트리거 포함), 트리거 함수 2개, 이번 기록 1행만 지운다.
-- 폴더나 폴더 연결이 한 줄이라도 있으면 멈춘다. 사용자가 만든 정리를 지워서 통과시키지 않는다(자료·프로젝트·Drive는 어느 경우에도 그대로).
-- 그런 경우 먼저 화면의 폴더 편집을 이전 코드로 되돌려 새 폴더가 생기지 않게 하고, 보관 여부를 정한 뒤 다시 계획한다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folders, public.app_library_folder_items in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022120000' and name = 'library_folders') <> 1 then
    raise exception 'LIBRARY_FOLDERS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_library_folders) or exists (select 1 from public.app_library_folder_items) then
    raise exception 'LIBRARY_FOLDERS_ROLLBACK_BLOCKED: folders exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_library_folder_items;
drop table public.app_library_folders;
drop function private.app_library_folder_tree_guard();
drop function private.app_library_folder_lift();

delete from supabase_migrations.schema_migrations
  where version = '20261022120000' and name = 'library_folders';
commit;
