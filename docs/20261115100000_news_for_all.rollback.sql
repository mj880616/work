begin;
-- 20261115100000_news_for_all의 짝 되돌리기. 새 표 둘·함수 넷·app_feed_rooms.news_at 칸·이번 기록 1행만 되돌린다.
-- 지워지는 것: 공용 기사 복사본·사람별 표시 복사본·뉴스방 표시(옛 표 app_news_items는 손대지 않았으므로 그대로 남는다).
-- 먼저 화면·수집기(Edge)가 새 표·함수를 부르지 않게 되돌린 뒤 실행한다(D2 외래 키 이동 뒤에는 D2 rollback을 먼저).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·정책·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115100000' and name = 'news_for_all') <> 1 then
    raise exception 'NEWS_FOR_ALL_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_news_room_take(uuid, text, jsonb);
drop function public.app_feed_room_news(text, boolean);
drop table public.app_news_marks;
drop table public.app_news_articles;
drop function private.app_news_scrap_reader_ok();
drop function private.app_news_reader_ok();
alter table public.app_feed_rooms drop column news_at;

delete from supabase_migrations.schema_migrations
  where version = '20261115100000' and name = 'news_for_all';
commit;
