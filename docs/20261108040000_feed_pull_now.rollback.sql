begin;
-- 20261108040000_feed_pull_now의 짝 되돌리기. 새 표 app_feed_pulls·함수 app_feed_pull_take·이번 기록 1행만 지운다. 다른 표·함수·권한은 그대로.
-- 지워지는 것은 [최신화] 누른 횟수 기록뿐이다(통화·텔레그램 소식은 다른 표라 그대로).
-- 되돌리기 전에 drive-summary를 이 함수를 부르지 않는 판으로 되돌려 두면 [최신화]가 '서버 준비 안 됨'으로 끝난다(되돌리지 않아도 소식 화면은 그대로).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261108040000' and name = 'feed_pull_now') <> 1
     or to_regclass('public.app_feed_pulls') is null
     or to_regprocedure('public.app_feed_pull_take(uuid,uuid,text)') is null then
    raise exception 'FEED_PULL_NOW_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_feed_pull_take(uuid, uuid, text);
drop table public.app_feed_pulls;

delete from supabase_migrations.schema_migrations
  where version = '20261108040000' and name = 'feed_pull_now';
commit;
