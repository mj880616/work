begin;
-- 20261119233000_note_folder_lock의 짝 되돌리기. 새 표 1개·새 함수 3개와 이번 기록 1행만 지운다.
-- 앞 단계(feature_pin_lock)·노트 폴더 표·기존 정책·권한·owner 함수는 건드리지 않는다. 잠근 노트 폴더 목록만 사라진다(노트·폴더·PIN은 그대로).
-- 지우기 전에 화면을 이 함수를 쓰지 않는 이전 판으로 되돌린다(화면 PR이 나간 뒤라면).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261119233000' and name = 'note_folder_lock') <> 1 then
    raise exception 'NOTE_FOLDER_LOCK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_lock_note_folder_set(text, uuid, boolean);
drop function public.app_lock_note_folders();
drop function private.app_lock_note_folder_list(uuid);

drop table public.app_note_folder_locks;

delete from supabase_migrations.schema_migrations
  where version = '20261119233000' and name = 'note_folder_lock';
commit;
