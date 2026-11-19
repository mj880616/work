begin;
-- 20261119000000_news_hand_fill의 짝 되돌리기. 검사 1개·칸 둘(author·manual_at)과 이번 기록 1행만 지운다.
-- ★ 먼저 화면 → Edge news-feed 순서로 이 기능 앞 커밋으로 되돌린다(새 화면은 두 칸을 읽고, 새 Edge hand_fill은 두 칸에 쓴다).
-- 사라지는 것: 손으로 넣은 기자 이름과 '직접 넣음' 표시. 손으로 넣은 제목·매체·시각·본문(기존 칸)과 별표·폴더는 그대로 남는다.
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261119000000' and name = 'news_hand_fill') <> 1 then
    raise exception 'NEWS_HAND_FILL_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_news_articles
  drop constraint app_news_articles_author_check,
  drop column author,
  drop column manual_at;

delete from supabase_migrations.schema_migrations
  where version = '20261119000000' and name = 'news_hand_fill';
commit;
