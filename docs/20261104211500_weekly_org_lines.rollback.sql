begin;
-- 20261104211500_weekly_org_lines의 짝 되돌리기. 새 표 1개(색인·정책·트리거 포함)·트리거 함수 1개와 이번 기록 1행만 지운다.
-- 기존 표(담당조직·기록·업데이트·현황 표)는 건드리지 않는다. 주별 조직보고 줄은 함께 사라진다(원래 기록은 그대로).
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(P3 화면이 나간 뒤라면).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261104211500' and name = 'weekly_org_lines') <> 1 then
    raise exception 'WEEKLY_ORG_LINES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_weekly_org_lines;
drop function private.app_weekly_org_lines_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261104211500' and name = 'weekly_org_lines';
commit;
