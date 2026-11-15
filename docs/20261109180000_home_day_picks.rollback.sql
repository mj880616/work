begin;
-- 20261109180000_home_day_picks의 짝 되돌리기. 새 표(정책 포함)를 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(새 표 지우기는 workflow rollback 모드 밖).
-- 먼저 이 표를 쓰는 ai-assist(home_day_picks)와 앱(홈 ②·③ 칸)을 이 표 이전 판으로 되돌린다(되돌리지 않으면 없는 표를 찾다 그 칸만 비고 다른 화면은 그대로).
-- 사라지는 것은 그날그날 AI가 고른 읽을 글·기록 제안 결과뿐이다(뉴스·일기·일정·할 일 원본은 그대로). 멈추지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261109180000' and name = 'home_day_picks') <> 1
     or to_regclass('public.app_home_day_picks') is null then
    raise exception 'HOME_DAY_PICKS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_home_day_picks;

delete from supabase_migrations.schema_migrations
  where version = '20261109180000' and name = 'home_day_picks';
commit;
