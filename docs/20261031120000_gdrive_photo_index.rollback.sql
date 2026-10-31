begin;
-- 20261031120000_gdrive_photo_index의 짝 되돌리기. 새 표 3개·gdrive_photos 허용 행·검사 원래 모양·이번 기록 1행만 되돌린다.
-- 색인 표 내용은 Drive에서 언제든 다시 받을 수 있는 목록 사본이라 지워도 데이터 손실이 아니다(켠 폴더 설정만 처음 상태로 돌아간다).
-- 지우기 전에 화면이 gdrive-photos를 부르지 않게 되돌린다(함수는 표가 없으면 사진 목록을 못 읽는다). Drive 파일·토큰은 손대지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261031120000' and name = 'gdrive_photo_index') <> 1 then
    raise exception 'GDRIVE_INDEX_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_gdrive_photos;
drop table public.app_gdrive_folders;
drop table public.app_gdrive_sync;
delete from public.app_operator_features where feature = 'gdrive_photos';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram'));

delete from supabase_migrations.schema_migrations
  where version = '20261031120000' and name = 'gdrive_photo_index';
commit;
