begin;
-- 20261103140000_photo_info_edits의 짝 되돌리기. 새 표 1개(색인·정책 포함)와 이번 기록 1행만 지운다.
-- 지우면 '사진 정보 고치기' 되돌리기 기록(앞·뒤 시각·위치)이 사라진다. 이미 고친 폰 사진 파일은 그대로다(되돌리지 않음).
-- 지우기 전에 화면을 이전 판으로 되돌린다(화면은 표가 없으면 고치기는 하되 '이번 화면에서만 되돌릴 수 있어요'로 알린다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261103140000' and name = 'photo_info_edits') <> 1 then
    raise exception 'PHOTO_INFO_EDITS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_photo_info_edits;

delete from supabase_migrations.schema_migrations
  where version = '20261103140000' and name = 'photo_info_edits';
commit;
