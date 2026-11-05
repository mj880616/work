begin;
-- 20261106050000_feed_bodies의 짝 되돌리기. 새 표 public.app_feed_bodies·트리거 함수 private.app_feed_bodies_scope_guard()·이번 기록 1행만 되돌린다.
-- 새 표에 줄이 하나라도 있으면 멈춘다(수집 때 저장한 본문·사진 주소가 사라지므로). 먼저 수집 Edge를 저장 전 판으로 되돌리고,
-- 줄이 있는데 꼭 되돌려야 하면 그 판단은 명진이 한다.
-- 사회운동 글(app_outside_posts)·뉴스 기사(app_news_items)·문장 표는 건드리지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261106050000' and name = 'feed_bodies') <> 1
     or to_regclass('public.app_feed_bodies') is null then
    raise exception 'FEED_BODIES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_bodies) then
    raise exception 'FEED_BODIES_ROLLBACK_BLOCKED: rows exist';
  end if;
end
$$;

drop table public.app_feed_bodies;
drop function private.app_feed_bodies_scope_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261106050000' and name = 'feed_bodies';
commit;
