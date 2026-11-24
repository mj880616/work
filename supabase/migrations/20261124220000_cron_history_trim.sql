-- S69-80 OPS-DB용량: pg_cron 실행 기록(cron.job_run_details)이 다시 쌓이지 않게 하루 한 번 3일 지난 줄을 지운다.
-- 배경: web2_feed_tick(1분마다)의 실행 기록이 쌓여 DB가 무료 한도 500MB를 넘었다(2026-11-24 CC가 손으로 비움).
-- 하는 것: 예약 1개 'web2_cron_history_trim'(UTC '43 18 * * *' = 서울 03:43, web2_feed_* 의 7·22분과 겹치지 않음)
--          명령 = delete from cron.job_run_details where end_time < now() - interval '3 days'
--          (끝나지 않은 줄 = end_time 없음은 비교가 참이 아니어서 남는다) + schema_migrations 기록 1행.
-- 같은 이름 예약이 이미 있으면 바꾸지 않고 멈춘다.
-- 안 하는 것: 다른 예약·표·정책·권한·함수 변경, 확장 켜기·끄기, rtw 객체, cron.timezone 변경.
-- ★ SQL Editor(폰 경로 C) 전용 ★ cron.schedule(cron 스키마 쓰기)이 있어 승인형 DB workflow가 거절한다(확장 규칙 'structure',
--   docs/ops-db-workflow.md · 앞선 예 20261106070000_feed_cron_schedule, docs/ops/retention-daily.apply.sql).
-- 사용법: precheck 캡처 → 새 쿼리 창(+)에 이 파일 begin;~commit; 붙여 넣기 → 첫 줄·마지막 줄(commit;)·대상 프로젝트 확인 → 실행 → postcheck 캡처.
-- 무료 한도 초과로 읽기 전용이면 "cannot execute ... in a read-only transaction" — 같은 창 맨 위에
--   set session characteristics as transaction read write; 한 줄을 더해 다시 실행한다.
-- 겹침: docs/ops/retention-daily.apply.sql(S67-24, 아직 적용 대기)의 web2_retention_daily도 같은 표를 7일 기준으로 지운다.
--   둘 다 있어도 해가 없다(이 예약이 3일로 먼저 지우면 그쪽은 지울 줄이 없음). 함께 돌지 않게 시각을 1시간 띄웠다(그쪽 17:43 UTC).
-- 짝: docs/20261124220000_cron_history_trim.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124220000')
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job') is null
     or to_regclass('cron.job_run_details') is null
     or coalesce(current_setting('cron.timezone', true), '') not in ('GMT', 'UTC', 'Etc/UTC')
     or exists (select 1 from cron.job where jobname = 'web2_cron_history_trim') then
    raise exception 'CRON_HISTORY_TRIM_PREREQUISITE_CHANGED: already applied, job exists or pg_cron missing; stop';
  end if;
end
$$;

select cron.schedule('web2_cron_history_trim', '43 18 * * *',
  $cmd$delete from cron.job_run_details where end_time < now() - interval '3 days'$cmd$);

do $$
begin
  if (select count(*) from cron.job where jobname = 'web2_cron_history_trim') <> 1
     or not exists (select 1 from cron.job where jobname = 'web2_cron_history_trim' and schedule = '43 18 * * *' and active
                      and command = $cmd$delete from cron.job_run_details where end_time < now() - interval '3 days'$cmd$) then
    raise exception 'CRON_HISTORY_TRIM_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124220000', 'cron_history_trim', array['S69-80 OPS: schedule pg_cron job web2_cron_history_trim daily at 18:43 UTC (03:43 KST) to delete cron.job_run_details rows whose end_time is older than 3 days (unfinished rows kept); stop if a job with that name exists; no other job, table, policy, grant or function change']);
commit;
