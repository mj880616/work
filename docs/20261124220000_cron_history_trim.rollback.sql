begin;
-- 20261124220000_cron_history_trim의 짝 되돌리기. SQL Editor(폰 경로 C) 전용(cron 문이 있어 승인형 workflow가 거절).
-- 하는 것: 예약 'web2_cron_history_trim' 하나만 끄고 지움 → 기록 1행 지움. 두 번 실행해도 된다(없으면 건너뜀).
-- 안 하는 것: 다른 예약, 이미 지워진 실행 기록 되살리기(실행 기록은 되돌릴 수 없고, 되살릴 필요도 없다), 확장 끄기.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if to_regclass('cron.job') is not null and exists (select 1 from cron.job where jobname = 'web2_cron_history_trim') then
    perform cron.unschedule('web2_cron_history_trim');
  end if;
  delete from supabase_migrations.schema_migrations where version = '20261124220000' and name = 'cron_history_trim';
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124220000')
     or (to_regclass('cron.job') is not null and exists (select 1 from cron.job where jobname = 'web2_cron_history_trim')) then
    raise exception 'CRON_HISTORY_TRIM_ROLLBACK_INCOMPLETE; stop';
  end if;
end
$$;
commit;
