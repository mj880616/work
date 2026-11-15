begin;
-- 20261108070000_news_highlights의 짝 되돌리기. 새 표 하나와 이번 기록 1행만 되돌린다.
-- 지워지는 것: 저장한 밑줄 글·메모(노트로 보낸 것은 노트에 그대로 남는다).
-- 먼저 화면이 밑줄 표를 부르지 않게 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261108070000' and name = 'news_highlights') <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_news_highlights;

delete from supabase_migrations.schema_migrations
  where version = '20261108070000' and name = 'news_highlights';
commit;
