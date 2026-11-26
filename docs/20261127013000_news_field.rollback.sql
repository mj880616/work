begin;
-- 20261127013000_news_field의 짝 되돌리기. 검사·칸 하나와 이번 기록 1행만 지운다.
-- ★ 먼저 Edge news-feed와 화면을 이 기능 앞 커밋으로 되돌린다(새 Edge는 넣을 때 news_field를 쓰고, 새 화면은 이 칸을 읽어서, 칸이 없으면 수집·목록이 실패한다).
-- 칸 값(분야)은 서버가 기사 제목·주소·피드로 다시 계산할 수 있는 값이라 지워도 기사·별표·폴더는 그대로다.
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127013000' and name = 'news_field') <> 1 then
    raise exception 'NEWS_FIELD_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_news_articles
  drop constraint app_news_articles_news_field_check,
  drop column news_field;

delete from supabase_migrations.schema_migrations
  where version = '20261127013000' and name = 'news_field';
commit;
