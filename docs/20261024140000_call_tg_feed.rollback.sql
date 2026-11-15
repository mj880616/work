begin;
-- 20261024140000_call_tg_feed의 짝 되돌리기. 새 표 2개(정책·색인·트리거 포함), 트리거 함수 1개, 이번 기록 1행만 지운다.
-- 소식·통화 줄이나 하루 숫자 줄이 한 줄이라도 있으면 멈춘다. 들어온 업무 기록을 지워서 통과시키지 않는다
-- (Drive 원본·분석 파일은 어느 경우에도 그대로). 그런 경우 먼저 collector-feed 비밀값을 지워 입구를 닫고,
-- 보관 여부를 정한 뒤 다시 계획한다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_feed_items, public.app_feed_days in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024140000' and name = 'call_tg_feed') <> 1 then
    raise exception 'CALL_TG_FEED_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_items) or exists (select 1 from public.app_feed_days) then
    raise exception 'CALL_TG_FEED_ROLLBACK_BLOCKED: feed rows exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_feed_items;
drop table public.app_feed_days;
drop function private.app_feed_item_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261024140000' and name = 'call_tg_feed';
commit;
