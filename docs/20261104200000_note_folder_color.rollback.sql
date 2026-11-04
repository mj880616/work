begin;
-- 20261104200000_note_folder_color의 짝 되돌리기. 함수 1개와 검사·color 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖). 폴더 색만 사라진다(화면은 모든 폴더를 안 고른 폴더처럼 보인다). 폴더·노트는 그대로다.
-- 먼저 이 변경을 쓰는 화면 PR을 되돌리거나, 되돌린 뒤 색 고르기 단추가 저장 실패 알림만 내는 것을 알고 진행한다.
-- 색을 고른 폴더가 있으면 그 값이 버려진다. 멈추지 않는다(색은 꾸미기뿐이고 되살리려면 다시 고르면 된다). 개수는 아래 확인 SQL로 먼저 볼 수 있다.
--   select count(*) from public.app_note_folders where color is not null;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261104200000' and name = 'note_folder_color') <> 1 then
    raise exception 'NOTE_FOLDER_COLOR_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_note_folder_set_color(uuid, smallint);

alter table public.app_note_folders drop constraint app_note_folders_color_check;
alter table public.app_note_folders drop column color;

delete from supabase_migrations.schema_migrations
  where version = '20261104200000' and name = 'note_folder_color';
commit;
