-- SELECT only. 적용 뒤 SQL Editor에서 실행해 캡처한다. 예/아니오 항목은 모두 예, 'other cron jobs hash'는 precheck와 같은 값이어야 한다.
-- 'other cron jobs hash'는 기대 주석 없이 둔다: 승인형 workflow가 사전 값과 같은지 본다.
-- 다음 날 볼 두 항목은 적용 직후엔 값이 정해지지 않으므로 기록만 한다.
-- expect: trim ran ok (next day) = 기록
-- expect: finished rows older than 3 days = 기록
select 'trim job 1' as item, case when (select count(*) from cron.job where jobname = 'web2_cron_history_trim') = 1 then '예' else '아니오' end as value
union all select 'trim job schedule 18:43 UTC active', case when exists (select 1 from cron.job where jobname = 'web2_cron_history_trim'
  and schedule = '43 18 * * *' and active) then '예' else '아니오' end
-- 명령 글자는 md5로 비교한다(확인 SQL은 쓰기 낱말을 글자로도 품지 않는다). 43dfefc7… = md5('delete from cron.job_run_details where end_time < now() - interval ''3 days''')
union all select 'trim job command', case when exists (select 1 from cron.job where jobname = 'web2_cron_history_trim'
  and md5(command) = '43dfefc7ce0ad45a12005b485461c33e') then '예' else '아니오' end
union all select 'migration recorded', case when (select count(*) from supabase_migrations.schema_migrations
  where version = '20261124220000' and name = 'cron_history_trim') = 1 then '예' else '아니오' end
union all select 'other cron jobs hash', coalesce((select md5(string_agg(jobid::text || ':' || jobname || ':' || schedule || ':' || active::text || ':' || md5(command), ',' order by jobid))
  from cron.job where jobname is distinct from 'web2_cron_history_trim'), 'none')
-- 다음 날(03:43 KST 뒤) 다시 보면 좋은 것: 정리 예약이 한 번 돌았는가(성공), 3일 넘은 끝난 줄이 0인가.
union all select 'trim ran ok (next day)', case when exists (select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where j.jobname = 'web2_cron_history_trim' and d.status = 'succeeded') then '예' else '아니오(첫 실행 전이면 정상)' end
union all select 'finished rows older than 3 days', (select count(*) from cron.job_run_details where end_time < now() - interval '3 days 1 hour')::text;
