begin;
-- 20261101230000_news_clipping의 짝 되돌리기. 새 표 넷·함수 셋·이번 기록 1행만 되돌린다.
-- 지워지는 것: 모아 둔 기사(제목·본문·요약·번역)·별표·별표 폴더·관심 키워드·하루 사용량.
-- 노트(app_notes)는 건드리지 않는다. 기사 메모 노트는 [노트]에 그대로 남고, metadata.news_item_id는 남아도 아무도 읽지 않는다.
-- 먼저 Edge news-feed 예약을 끄고, 화면이 뉴스 클리핑 표를 부르지 않게 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101230000' and name = 'news_clipping') <> 1 then
    raise exception 'NEWS_CLIPPING_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_news_prune(timestamptz, integer);
drop table public.app_news_items;
drop table public.app_news_folders;
drop table public.app_news_keywords;
drop table public.app_news_days;
drop function private.app_news_folder_tree_guard();
drop function private.app_news_folder_lift();

delete from supabase_migrations.schema_migrations
  where version = '20261101230000' and name = 'news_clipping';
commit;
