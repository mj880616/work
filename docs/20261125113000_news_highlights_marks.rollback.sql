begin;
-- 20261125113000_news_highlights_marks의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 새 칸이 없으면 형광펜만 거절되고 밑줄 저장은 그대로 된다).
-- 지우는 것: 형광펜 줄(mark_kind = 'highlight' — 칸을 지우면 밑줄 줄로 바뀌어 모아 보기에 섞이므로 먼저 지운다),
--   새 칸 2개(mark_kind·mark_color)와 새 제약·칸 권한, 이번 기록 1행. 지금까지의 밑줄 줄(두 칸 비움)은 한 줄도 지우지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125113000' and name = 'news_highlights_marks') <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_MARKS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_news_highlights where mark_kind = 'highlight';
alter table public.app_news_highlights drop constraint app_news_highlights_mark_check;
alter table public.app_news_highlights drop column mark_kind;
alter table public.app_news_highlights drop column mark_color;

delete from supabase_migrations.schema_migrations
  where version = '20261125113000' and name = 'news_highlights_marks';
commit;
