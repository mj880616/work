begin;
-- 20261104162800_cloud_jobs의 짝 되돌리기. 새 표 2개(색인·정책·참조 포함)와 이번 기록 1행만 지운다.
-- 지우면 전송 작업 기록(진행·상태)과 이어 올리기 자리가 사라진다. 클라우드 파일·색인(app_cloud_items)은 그대로다.
-- 보내는 중인 큰 파일은 받을 클라우드에 반쯤 올라간 채 남지 않는다(이어 올리기 자리는 완료 전에는 파일이 아니며 클라우드가 며칠 뒤 버림).
-- 지우기 전에 화면을 이전 판으로, Edge cloud-files를 이전 판으로 되돌린다(전송 목록·큰 파일 길만 사라지고 2-① 복사 길로 돌아간다).
-- 보내는 중(queued·running) 줄이 있으면 멈춘다(화면에서 '모두 멈춤' 뒤 다시).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261104162800' and name = 'cloud_jobs') <> 1 then
    raise exception 'CLOUD_JOBS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_cloud_jobs where status in ('queued', 'running')) then
    raise exception 'CLOUD_JOBS_ROLLBACK_BLOCKED: jobs still running';
  end if;
end
$$;

drop table public.app_cloud_job_uploads;
drop table public.app_cloud_jobs;

delete from supabase_migrations.schema_migrations
  where version = '20261104162800' and name = 'cloud_jobs';
commit;
