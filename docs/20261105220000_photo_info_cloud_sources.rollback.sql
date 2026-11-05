begin;
-- 20261105220000_photo_info_cloud_sources의 짝 되돌리기. 출처 검사를 원래 모양('phone'만)으로 다시 만들고 기록 1행을 지운다.
-- 원드라이브·구글 드라이브 되돌리기 기록 줄이 있으면 멈춘다(지우면 그 사진들을 [되돌리기]로 원래대로 돌릴 수 없으므로). 그때는 먼저 화면을 이전 판으로 두고,
-- 아래 확인 SQL로 개수를 본 뒤 명진이 정한다.
--   select source, count(*) from public.app_photo_info_edits where source in ('onedrive', 'gdrive') group by 1;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_photo_info_edits in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261105220000' and name = 'photo_info_cloud_sources') <> 1 then
    raise exception 'PHOTO_INFO_CLOUD_SOURCES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_photo_info_edits where source <> 'phone') then
    raise exception 'PHOTO_INFO_CLOUD_SOURCES_ROLLBACK_BLOCKED: cloud rows exist';
  end if;
end
$$;

alter table public.app_photo_info_edits drop constraint app_photo_info_edits_source_check;
alter table public.app_photo_info_edits add constraint app_photo_info_edits_source_check check (source in ('phone'));

delete from supabase_migrations.schema_migrations
  where version = '20261105220000' and name = 'photo_info_cloud_sources';
commit;
