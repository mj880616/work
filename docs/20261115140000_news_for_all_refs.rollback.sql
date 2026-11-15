begin;
-- 20261115140000_news_for_all_refs의 짝 되돌리기. 새 표 다섯·함수 하나·이번 기록 1행만 되돌린다.
-- 지워지는 것: 공용 본문 블록·사람별 읽음/자세히/반응 복사본·옛 id 지도. 7-1에서 공용 기사로 더 복사한 줄은 남는다(D1 표의 줄 — 옛 표에도 같은 주소가 있어 잃는 것 없음).
-- 옛 표(app_news_items·app_feed_bodies·app_feed_reads·app_now_details·app_now_signals)는 손대지 않았으므로 그대로다.
-- 먼저 화면·Edge가 새 표·함수를 부르지 않게 되돌린 뒤 실행한다. SQL Editor(폰 경로 C) 전용(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115140000' and name = 'news_for_all_refs') <> 1 then
    raise exception 'NEWS_REFS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_news_article_of(uuid[]);
drop table public.app_news_id_map;
drop table public.app_news_now_signals;
drop table public.app_news_now_details;
drop table public.app_news_reads;
drop table public.app_news_article_bodies;

delete from supabase_migrations.schema_migrations
  where version = '20261115140000' and name = 'news_for_all_refs';
commit;
