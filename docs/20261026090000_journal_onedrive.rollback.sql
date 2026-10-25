begin;
-- 20261026090000_journal_onedrive의 짝 되돌리기. 새 표 3개(정책·색인 포함)와 이번 기록 1행만 지운다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
-- 별표 기록이 한 줄이라도 있으면 멈춘다(명진이 직접 표시한 자료라 지워서 통과시키지 않는다). 그 경우 별표 목록을 먼저 보관한 뒤 복구 계획을 따로 세운다.
-- 연결(토큰)·사진 색인은 다시 만들 수 있는 값이라 있어도 지운다. 단, 지우기 전에 Edge `onedrive-photos`를 쓰는 화면이 없는지 확인한다(없으면 영향 없음).
-- 원드라이브 쪽 연결 해제는 이 SQL이 하지 못한다: Microsoft 계정의 "앱 및 서비스 권한" 화면에서 앱을 제거하면 토큰이 무효가 된다.
-- 기존 표·정책·함수·Google 연결에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_diary_photo_stars in access exclusive mode;
lock table public.app_onedrive_photos in access exclusive mode;
lock table public.app_onedrive_connections in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261026090000' and name = 'journal_onedrive') <> 1 then
    raise exception 'JOURNAL_ONEDRIVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_diary_photo_stars) then
    raise exception 'JOURNAL_ONEDRIVE_ROLLBACK_BLOCKED: diary photo stars exist; preserve them and plan recovery';
  end if;
end
$$;

drop table public.app_diary_photo_stars;
drop table public.app_onedrive_photos;
drop table public.app_onedrive_connections;

delete from supabase_migrations.schema_migrations
  where version = '20261026090000' and name = 'journal_onedrive';
commit;
