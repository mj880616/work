begin;
-- 20261028170000_note_folders의 짝 되돌리기. 새 표 1개(색인·정책·트리거 포함)·트리거 함수 2개와 이번 기록 1행만 지운다.
-- 노트(app_notes)는 건드리지 않는다. 노트 metadata.folder(폴더 이름)는 화면이 늘 함께 적어 두므로 옛 화면(한 단계 폴더 줄)에서
-- 그 이름으로 다시 보인다(폴더 안 폴더는 맨 끝 폴더 이름 하나로 보임). metadata.folder_id는 남아도 아무도 읽지 않는다.
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(새 화면은 표가 없으면 이름 폴더만 읽기 전용으로 보인다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028170000' and name = 'note_folders') <> 1 then
    raise exception 'NOTE_FOLDERS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_note_folders;
drop function private.app_note_folder_tree_guard();
drop function private.app_note_folder_lift();

delete from supabase_migrations.schema_migrations
  where version = '20261028170000' and name = 'note_folders';
commit;
