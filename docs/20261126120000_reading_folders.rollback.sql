begin;
-- 20261126120000_reading_folders의 짝 되돌리기(SQL Editor 전용 — 표 지우기는 승인형 workflow rollback 모드가 받지 않는다).
-- 저장한 글의 폴더 칸(app_reading_items.folder_id, 그 외래 키·색인·칸 권한이 함께 사라짐)과 새 폴더 표(app_reading_folders)를 지우고 이번 기록 1행만 지운다.
-- 폴더가 하나라도 있으면 멈춘다 — 지우면 명진이 만든 폴더와 글의 폴더 자리가 사라지므로, 먼저 어떻게 할지 정한 뒤 다시 계획한다.
-- 저장한 글의 다른 칸·권한·정책·자료에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126120000' and name = 'reading_folders') <> 1 then
    raise exception 'READING_FOLDERS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_reading_folders) then
    raise exception 'READING_FOLDERS_ROLLBACK_BLOCKED: folders exist; decide them first';
  end if;
end
$$;

alter table public.app_reading_items drop column folder_id;
drop table public.app_reading_folders;

delete from supabase_migrations.schema_migrations
  where version = '20261126120000' and name = 'reading_folders';
commit;
