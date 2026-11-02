begin;
-- 20261102160000_cloud_files_index의 짝 되돌리기. 새 함수 3개·새 표 3개·files 허용 행·검사 원래 모양·이번 기록 1행만 되돌린다.
-- 색인 표 내용은 클라우드에서 언제든 다시 받을 수 있는 목록 사본이라 지워도 파일 손실이 아니다(별표만 사라진다).
-- 지우기 전에 화면이 파일 메뉴·cloud-files를 부르지 않게 되돌린다. 원드라이브·구글 드라이브 파일과 토큰은 손대지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261102160000' and name = 'cloud_files_index') <> 1 then
    raise exception 'CLOUD_FILES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_cloud_find(text, text, integer);
drop function public.app_cloud_trail(text, text);
drop function public.app_cloud_list(text, text);
drop table public.app_cloud_stars;
drop table public.app_cloud_items;
drop table public.app_cloud_sync;
delete from public.app_operator_features where feature = 'files';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos'));

delete from supabase_migrations.schema_migrations
  where version = '20261102160000' and name = 'cloud_files_index';
commit;
