-- S67-24 DB-보관기간정리 ② 되돌리기 — ★ SQL Editor(폰 경로 C) 전용 ★ 새 쿼리 창(+)에 통째로 붙여 넣고 첫 줄·마지막 줄(commit;)·대상 프로젝트 확인 뒤 실행.
-- 매일 정리 예약(web2_retention_daily)을 끄고, 매일 정리 함수와 백업 기록 표를 지운다.
-- ★ 이미 지운 기사·실행 기록·백업 사본은 되살리지 않는다(되살릴 수 없음). 정리 함수 둘은 migration 짝 rollback
--   (docs/20261120130000_news_outside_retention.rollback.sql)이 되돌린다 — 이 파일을 먼저, 그다음 그 파일.
-- 다른 예약(web2_feed_*)·표·권한은 건드리지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if (select count(*) from cron.job where jobname = 'web2_retention_daily') <> 1 then
    raise exception 'RETENTION_DAILY_ROLLBACK_BLOCKED: job missing or duplicated; stop';
  end if;
end
$$;
select cron.unschedule('web2_retention_daily');
drop function private.app_retention_daily();
drop table private.app_ops_backup_seen;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'web2_retention_daily')
     or to_regprocedure('private.app_retention_daily()') is not null
     or to_regclass('private.app_ops_backup_seen') is not null
     or (select count(*) from cron.job where jobname like 'web2\_feed\_%') <> 4 then
    raise exception 'RETENTION_DAILY_ROLLBACK_POSTCHECK_FAILED; stop';
  end if;
end
$$;
commit;
