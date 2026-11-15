begin;
-- 20261115150000_outside_for_all의 짝 되돌리기. 새 표 여덟·함수 둘·이번 기록 1행만 되돌린다.
-- 지워지는 것: 공용 글·문장·본문 복사본, 사람별 표시·읽음·자세히·반응 복사본, 옛 id 지도. 옛 표(app_outside_posts·문장·표시·본문·읽음·now)는 손대지 않았으므로 그대로다.
-- 먼저 화면·Edge(outside-feed)가 새 표·함수를 부르지 않게 되돌린 뒤 실행한다. SQL Editor(폰 경로 C) 전용(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115150000' and name = 'outside_for_all') <> 1 then
    raise exception 'OUTSIDE_FOR_ALL_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_outside_search_shared(text, text[], text[], date, date, integer, integer);
drop function public.app_outside_article_of(uuid[]);
drop table public.app_outside_id_map;
drop table public.app_outside_now_signals;
drop table public.app_outside_now_details;
drop table public.app_outside_reads;
drop table public.app_outside_article_bodies;
drop table public.app_outside_article_marks;
drop table public.app_outside_article_sentences;
drop table public.app_outside_articles;

delete from supabase_migrations.schema_migrations
  where version = '20261115150000' and name = 'outside_for_all';
commit;
