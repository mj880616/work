begin;
-- 20261124100000_library_folder_drive의 짝 되돌리기. 함수 1개와 unique index·검사·drive_folder_id 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(확장 규칙 migration). 먼저 Edge workspace-drive를 이 변경 전 판으로 되돌린다(새 판은 이 칸을 읽고 쓴다).
-- 짝 드라이브 폴더 id만 사라진다. 드라이브의 폴더·파일과 앱 폴더·자료는 그대로다(다시 적용하면 [드라이브 폴더 맞추기]가 같은 이름 폴더를 다시 찾아 짝짓는다).
--   개수 확인: select count(*) from public.app_library_folders where drive_folder_id is not null;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261124100000' and name = 'library_folder_drive') <> 1 then
    raise exception 'LIBRARY_FOLDER_DRIVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_library_folder_set_drive(uuid, text, text);

drop index public.app_library_folders_drive_folder_idx;
alter table public.app_library_folders drop constraint app_library_folders_drive_folder_check;
alter table public.app_library_folders drop column drive_folder_id;

delete from supabase_migrations.schema_migrations
  where version = '20261124100000' and name = 'library_folder_drive';
commit;
