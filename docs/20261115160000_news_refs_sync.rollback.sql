begin;
-- 20261115160000_news_refs_sync의 짝 되돌리기. 보충 함수 하나·이번 기록 1행만 되돌린다.
-- 보충으로 새 표(D2)에 더해진 줄(지도·공용 본문·사람별 읽음/자세히/반응·옛 표에만 있던 주소의 공용 기사)은 남긴다: 옛 표 줄을 같은 규칙으로 옮긴 사본이라
-- 잃는 것 없음, D2 되돌리기가 새 표째 지운다. 옛 표는 손대지 않았으므로 그대로다.
-- 먼저 news-feed를 이전 커밋으로 되돌려(보충 함수를 부르지 않게) 실행한다. 부르는 쪽이 남아 있어도 news-feed는 실패를 로그만 남기고 지우기를 이어 간다.
-- SQL Editor(폰 경로 C) 전용.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115160000' and name = 'news_refs_sync') <> 1 then
    raise exception 'NEWS_REFS_SYNC_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_news_refs_sync(integer);

delete from supabase_migrations.schema_migrations
  where version = '20261115160000' and name = 'news_refs_sync';
commit;
