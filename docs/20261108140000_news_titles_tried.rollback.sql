begin;
-- 20261108140000_news_titles_tried의 짝 되돌리기. title_tried_at 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖).
-- 먼저 이 칸을 쓰는 news-feed를 이 칸 이전 판으로 되돌린다(되돌리지 않으면 제목 번역 단계가 없는 칸을 찾다 실패한다).
-- 사라지는 것은 '마지막으로 번역을 시도한 시각'뿐이다(번역·기사 내용은 그대로). 멈추지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261108140000' and name = 'news_titles_tried') <> 1 then
    raise exception 'NEWS_TITLES_TRIED_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_news_items drop column title_tried_at;

delete from supabase_migrations.schema_migrations
  where version = '20261108140000' and name = 'news_titles_tried';
commit;
