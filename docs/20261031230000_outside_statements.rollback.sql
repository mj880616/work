begin;
-- 20261031230000_outside_statements의 짝 되돌리기. 새 표 넷·찾기 함수·이번 기록 1행만 되돌린다.
-- 지워지는 것: 모아 둔 바깥 글(각 단체 홈페이지에서 다시 읽을 수 있는 공개 글 사본)·켠 단체 목록·마지막으로 본 시각.
-- 먼저 Edge outside-feed 예약(outside-feed.yml)을 끄고, 화면이 바깥 성명 표를 부르지 않게 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261031230000' and name = 'outside_statements') <> 1 then
    raise exception 'OUTSIDE_STATEMENTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_outside_search(text, text[], text[], date, date, integer, integer);
drop table public.app_outside_sentences;
drop table public.app_outside_posts;
drop table public.app_outside_sources;
drop table public.app_outside_seen;

delete from supabase_migrations.schema_migrations
  where version = '20261031230000' and name = 'outside_statements';
commit;
