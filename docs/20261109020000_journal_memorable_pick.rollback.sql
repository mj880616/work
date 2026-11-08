begin;
-- 20261109020000_journal_memorable_pick의 짝 되돌리기. 새 표(정책·색인 포함)를 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(새 표 지우기는 workflow rollback 모드 밖).
-- 먼저 이 표를 쓰는 ai-assist와 앱(잊지 말기 소식 읽기)을 이 표 이전 판으로 되돌린다(되돌리지 않으면 없는 표를 찾다 소식 고르기·읽기가 실패한다).
-- 사라지는 것은 AI가 정한 종류·이유 한 줄뿐이다(소식 줄·상태는 app_journal_memorable에 그대로). 멈추지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261109020000' and name = 'journal_memorable_pick') <> 1
     or to_regclass('public.app_journal_memorable_picks') is null then
    raise exception 'JOURNAL_MEMORABLE_PICK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_journal_memorable_picks;

delete from supabase_migrations.schema_migrations
  where version = '20261109020000' and name = 'journal_memorable_pick';
commit;
