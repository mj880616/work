-- SELECT only. SQL Editor에서 적용 전에 실행해 캡처한다. 카탈로그·cron 예약 표·migration 기록만 읽는다(예약 명령 본문·실행 결과 글은 읽지 않음).
-- expect: pg_cron ready = 예
-- expect: cron timezone UTC = 예
-- expect: trim job absent = 예
-- expect: new migration absent = 예
-- expect: cron jobs = 기록
-- expect: other cron jobs hash = 기록
-- expect: retention daily job present = 기록
-- expect: run details rows = 기록
-- expect: run details unfinished rows = 기록
-- expect: run details MB = 기록
-- expect: database size MB = 기록
select 'pg_cron ready' as item, case when to_regprocedure('cron.schedule(text,text,text)') is not null
  and to_regprocedure('cron.unschedule(text)') is not null and to_regclass('cron.job_run_details') is not null then '예' else '아니오' end as value
union all select 'cron timezone UTC', case when coalesce(current_setting('cron.timezone', true), '') in ('GMT', 'UTC', 'Etc/UTC') then '예' else '아니오' end
union all select 'trim job absent', case when not exists (select 1 from cron.job where jobname = 'web2_cron_history_trim') then '예' else '아니오' end
union all select 'new migration absent', case when not exists (select 1 from supabase_migrations.schema_migrations where version = '20261124220000') then '예' else '아니오' end
union all select 'cron jobs', (select count(*) from cron.job)::text
union all select 'other cron jobs hash', coalesce((select md5(string_agg(jobid::text || ':' || jobname || ':' || schedule || ':' || active::text || ':' || md5(command), ',' order by jobid))
  from cron.job where jobname is distinct from 'web2_cron_history_trim'), 'none')
union all select 'retention daily job present', case when exists (select 1 from cron.job where jobname = 'web2_retention_daily') then '예' else '아니오' end
union all select 'run details rows', (select count(*) from cron.job_run_details)::text
union all select 'run details unfinished rows', (select count(*) from cron.job_run_details where end_time is null)::text
union all select 'run details MB', round(pg_total_relation_size('cron.job_run_details') / 1048576.0)::text
union all select 'database size MB', round(pg_database_size(current_database()) / 1048576.0)::text;
