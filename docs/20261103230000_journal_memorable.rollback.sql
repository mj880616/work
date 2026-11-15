begin;
-- 20261103230000_journal_memorable의 짝 되돌리기. 새 표 2개(색인·정책 포함)와 이번 기록 1행만 지운다.
-- 지우면 '기억할 통화·텔레그램' 제안·고른 결과(넣음/뺌)가 사라진다. 통화·텔레그램 원본(app_feed_items)과 주간보고 초안은 그대로다.
-- 지우기 전에 화면을 이전 판으로 되돌린다(화면은 표가 없으면 이 묶음을 그리지 않는다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261103230000' and name = 'journal_memorable') <> 1 then
    raise exception 'JOURNAL_MEMORABLE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_journal_memorable;
drop table public.app_journal_memorable_runs;

delete from supabase_migrations.schema_migrations
  where version = '20261103230000' and name = 'journal_memorable';
commit;
