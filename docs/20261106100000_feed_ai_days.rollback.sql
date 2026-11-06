begin;
-- 20261106100000_feed_ai_days의 짝 되돌리기. 새 표 public.app_feed_ai_days·상세 표 칸 app_now_details.topic(과 그 검사)·이번 기록 1행만 되돌린다.
-- 멈추는 경우(자료를 지우지 않는다):
--   - 새 표에 줄이 하나라도 있으면 멈춘다(AI 사용량 기록이 사라지므로). 먼저 수집 Edge(P3c)를 기록 전 판으로 되돌리고,
--     줄이 있는데 꼭 되돌려야 하면 그 판단은 명진이 한다.
--   - 상세 줄 중 하나라도 topic 값이 있으면 멈춘다(분류 꼬리표가 사라지므로). 값 지우기도 명진 판단.
-- 상세의 다른 칸·줄·정책·권한, 사회운동 글·뉴스 기사는 건드리지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_now_details in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261106100000' and name = 'feed_ai_days') <> 1
     or to_regclass('public.app_feed_ai_days') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_now_details'::regclass and attname = 'topic' and not attisdropped) then
    raise exception 'FEED_AI_DAYS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_ai_days) then
    raise exception 'FEED_AI_DAYS_ROLLBACK_BLOCKED: rows exist';
  end if;
  if exists (select 1 from public.app_now_details where topic is not null) then
    raise exception 'FEED_AI_DAYS_ROLLBACK_BLOCKED: topic values exist';
  end if;
end
$$;

drop table public.app_feed_ai_days;
alter table public.app_now_details drop column topic;

delete from supabase_migrations.schema_migrations
  where version = '20261106100000' and name = 'feed_ai_days';
commit;
