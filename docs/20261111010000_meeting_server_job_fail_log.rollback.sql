begin;
-- 20261111010000_meeting_server_job_fail_log의 짝 되돌리기. 이번에 만든 것만 지운다: 트리거 1개·함수 1개·검사 1개·칸 1개(fail_log)·이번 기록 1행.
-- 사라지는 것: 서버 정리 실패 이력. 작업 상태·전사 글·요약·정책·다른 권한은 그대로.
-- 순서: Edge는 그대로 둬도 된다(Edge는 이 칸을 읽거나 쓰지 않는다. 이력은 트리거가 남긴다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meeting_server_jobs in access exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261111010000' and name = 'meeting_server_job_fail_log') <> 1 then
    raise exception 'MEETING_SERVER_JOB_FAIL_LOG_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;
drop trigger app_meeting_server_jobs_fail_log on public.app_meeting_server_jobs;
drop function private.app_meeting_server_jobs_fail_log();
alter table public.app_meeting_server_jobs drop constraint app_meeting_server_jobs_fail_log_check;
alter table public.app_meeting_server_jobs drop column fail_log;
delete from supabase_migrations.schema_migrations
  where version = '20261111010000' and name = 'meeting_server_job_fail_log';
commit;
