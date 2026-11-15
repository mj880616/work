begin;
-- 20261026140000_diary_onedrive_db의 짝 되돌리기. 새 표 2개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 별표 기록이 한 줄이라도 있으면 멈춘다. 내용을 지워서 통과시키지 않는다(명진이 표시한 별표가 사라진다).
-- 원드라이브 연결 행은 지워도 데이터 손실이 아니다(다시 연결하면 되고, 연결 취소와 같다). 단 지우기 전에 사용자가 연결을 끊었는지 확인한다.
-- 그런 경우 먼저 화면·Edge 사용을 멈추고, 별표 목록을 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_diary_stars in access exclusive mode;
lock table public.app_onedrive_connections in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261026140000' and name = 'diary_onedrive_db') <> 1 then
    raise exception 'DIARY_ONEDRIVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_diary_stars) then
    raise exception 'DIARY_ONEDRIVE_ROLLBACK_BLOCKED: diary stars exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_diary_stars;
drop table public.app_onedrive_connections;

delete from supabase_migrations.schema_migrations
  where version = '20261026140000' and name = 'diary_onedrive_db';
commit;
