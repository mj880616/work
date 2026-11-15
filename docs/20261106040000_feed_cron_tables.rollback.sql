begin;
-- 20261106040000_feed_cron_tables의 짝 되돌리기. 새 표 셋(예약 지문·예약 칸·일)·함수 다섯·이번 기록 1행만 지운다. 다른 표·함수·권한은 그대로.
-- 지워지는 것은 수집 예약 기록(칸·일 줄)과 열쇠 지문뿐이다(수집된 글·기사는 다른 표라 그대로).
-- DB 예약(P1b, 이름 앞머리 web2_feed_)이 아직 이 함수를 부르고 있으면 멈춘다: 먼저 P1b 되돌리기(cron.unschedule 4줄 + 금고 값·지문)를 한 뒤 실행한다.
-- 지문 표가 없어지면 Edge의 지문 입구(P1c)는 통과시키지 않고, 지금 비밀값 입구(GitHub 수동 실행)는 그대로 된다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261106040000' and name = 'feed_cron_tables') <> 1
     or to_regclass('public.app_cron_keys') is null
     or to_regclass('public.app_feed_runs') is null
     or to_regclass('public.app_feed_jobs') is null then
    raise exception 'FEED_CRON_TABLES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where command ~ 'app_feed_') then
      raise exception 'FEED_CRON_TABLES_ROLLBACK_BLOCKED: cron schedule still calls these functions';
    end if;
  end if;
end
$$;

drop function private.app_feed_tidy();
drop function private.app_feed_settle(bigint, integer, text);
drop function private.app_feed_sent(uuid, bigint);
drop function private.app_feed_claim(text);
drop function private.app_feed_enqueue(text);
drop table public.app_feed_jobs;
drop table public.app_feed_runs;
drop table public.app_cron_keys;

delete from supabase_migrations.schema_migrations
  where version = '20261106040000' and name = 'feed_cron_tables';
commit;
