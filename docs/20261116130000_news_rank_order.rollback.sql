begin;
-- 20261116130000_news_rank_order의 짝 되돌리기. 색인·검사·칸 둘과 이번 기록 1행만 지운다.
-- ★ 먼저 Edge news-feed를 이 기능 앞 커밋으로 되돌린다(새 Edge는 넣을 때 news_rank를 써서, 칸이 없으면 수집이 실패한다).
-- 칸 값(등급·서울 날짜)은 서버가 기사 제목·받은 시각으로 다시 계산할 수 있는 값이라 지워도 기사·별표·폴더는 그대로다.
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261116130000' and name = 'news_rank_order') <> 1 then
    raise exception 'NEWS_RANK_ORDER_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop index public.app_news_articles_day_rank_idx;
alter table public.app_news_articles
  drop constraint app_news_articles_news_rank_check,
  drop column news_rank,
  drop column kst_day;

delete from supabase_migrations.schema_migrations
  where version = '20261116130000' and name = 'news_rank_order';
commit;
