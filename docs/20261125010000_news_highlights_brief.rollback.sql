begin;
-- 20261125010000_news_highlights_brief의 짝 되돌리기. 종류 검사를 원래 모양(news·outside·telegram·note·reading)으로, 이번 기록 1행을 지운다.
-- 브리핑에서 저장한 밑줄(source_type='brief')이 있으면 검사를 되돌릴 수 없어 그 밑줄 행만 지운다(브리핑·자료·노트는 그대로, 밑줄 글 사본만 사라짐).
-- 되돌리기 전에 브리핑 [밑줄 저장] 화면 PR이 운영에 있으면 그것을 먼저 되돌린다(아니면 브리핑에서 밑줄 저장이 실패로 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125010000' and name = 'news_highlights_brief') <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_BRIEF_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_news_highlights where source_type = 'brief';
alter table public.app_news_highlights drop constraint app_news_highlights_type_check;
alter table public.app_news_highlights add constraint app_news_highlights_type_check
  check (source_type in ('news', 'outside', 'telegram', 'note', 'reading'));

delete from supabase_migrations.schema_migrations
  where version = '20261125010000' and name = 'news_highlights_brief';
commit;
