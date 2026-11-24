-- SELECT only. 적용 전 저장(캡처). 예약 목록은 이름·시각·켜짐·명령 해시만(명령 본문은 찍지 않음), 그리고 이번 기록 유무.
select 'cron job' as kind, jobname as name, schedule || ':active=' || active::text || ':cmd_md5=' || md5(command) || ':user=' || username as definition
  from cron.job
union all select 'cron owner', c.relname, pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, 'none')
  from pg_class c where c.oid in (to_regclass('cron.job'), to_regclass('cron.job_run_details'))
union all select 'cron timezone', 'cron.timezone', coalesce(current_setting('cron.timezone', true), 'none')
union all select 'history', version, name from supabase_migrations.schema_migrations where version = '20261124220000'
order by 1, 2;
