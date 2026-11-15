begin;
-- 20261106070000_feed_cron_schedule(P1b)의 짝 되돌리기. SQL Editor(폰 경로 C) 전용(cron·vault 문이 있어 승인형 workflow가 거절).
-- 하는 것: 예약 4개(web2_feed_outside·web2_feed_news·web2_feed_news_fill·web2_feed_tick) 끄고 지움 → 금고 값 둘(web2_feed_cron·web2_feed_project_url)
--          지움 → 지문 행(app_cron_keys 'web2_feed_cron') 지움 → 기록 1행 지움. 조각 ②까지만 했거나 ③까지 했어도, 두 번 실행해도 된다(없는 것은 건너뜀).
-- 안 하는 것: 확장 끄기(pg_cron·pg_net은 읽생기와 같은 DB — 끄기는 따로 판단), P1a 표·함수·쌓인 칸·일 줄 지움, 다른 예약·금고 값.
-- 지운 뒤: DB 예약이 멈추고, Edge의 지문 입구는 지문 행이 없어 통과시키지 않는다(GitHub 수동 실행 = 지금 비밀값 입구는 그대로).
--          GitHub 예약을 이미 뺐다면(P1d) 그 PR을 되돌려 schedule을 되살린다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_name text;
begin
  if to_regclass('cron.job') is not null then
    for v_name in
      select jobname from cron.job
       where jobname in ('web2_feed_outside', 'web2_feed_news', 'web2_feed_news_fill', 'web2_feed_tick')
       order by jobname
    loop
      perform cron.unschedule(v_name);
    end loop;
  end if;
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets where name in ('web2_feed_cron', 'web2_feed_project_url');
  end if;
  if to_regclass('public.app_cron_keys') is not null then
    delete from public.app_cron_keys where name = 'web2_feed_cron';
  end if;
  delete from supabase_migrations.schema_migrations where version = '20261106070000' and name = 'feed_cron_schedule';

  -- 끝 검사: 하나라도 남으면 전체 취소.
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106070000')
     or (to_regclass('public.app_cron_keys') is not null and exists (select 1 from public.app_cron_keys where name = 'web2_feed_cron')) then
    raise exception 'FEED_CRON_SCHEDULE_ROLLBACK_INCOMPLETE; stop';
  end if;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname like 'web2\_feed\_%') then
      raise exception 'FEED_CRON_SCHEDULE_ROLLBACK_INCOMPLETE: jobs remain; stop';
    end if;
  end if;
  if to_regclass('vault.secrets') is not null then
    if exists (select 1 from vault.secrets where name in ('web2_feed_cron', 'web2_feed_project_url')) then
      raise exception 'FEED_CRON_SCHEDULE_ROLLBACK_INCOMPLETE: vault secrets remain; stop';
    end if;
  end if;
end
$$;
commit;
