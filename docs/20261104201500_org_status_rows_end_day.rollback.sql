begin;
-- 20261104201500_org_status_rows_end_day의 짝 되돌리기. 새 칸 end_day와 검사 1개, 이번 기록 1행만 지운다.
-- 기존 칸·행·정책·권한은 건드리지 않는다. 적어 둔 '끝나는 날' 값만 사라진다(시작일·글은 그대로).
-- 지우기 전에 화면을 end_day를 쓰지 않는 이전 판으로 되돌려야 한다(새 화면은 칸이 없으면 줄 읽기가 실패한다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 칸 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261104201500' and name = 'org_status_rows_end_day') <> 1 then
    raise exception 'ORG_STATUS_END_DAY_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_org_status_rows drop constraint app_org_status_rows_end_check;
alter table public.app_org_status_rows drop column end_day;

delete from supabase_migrations.schema_migrations
  where version = '20261104201500' and name = 'org_status_rows_end_day';
commit;
