begin;
-- 20261103170000_meeting_server_jobs의 짝 되돌리기. 새 표 1개(색인·정책·참조 포함)와 이번 기록 1행만 지운다.
-- 지우면 서버 정리 작업 기록(단계·진행·전사 전문·요약 초안)이 사라진다. 소리 파일(명진 Drive)·구간 기록·전사 작업 기록·
-- 회의 기록(이미 [사업 보고 저장]한 회의록 전문 포함)·사용량 기록은 그대로다.
-- 지우기 전에 화면을 이전 판으로, Edge meeting-transcribe를 이전 판으로 되돌린다(서버 정리 길만 사라지고 화면 정리 길로 돌아간다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261103170000' and name = 'meeting_server_jobs') <> 1 then
    raise exception 'MEETING_SERVER_JOBS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_meeting_server_jobs;

delete from supabase_migrations.schema_migrations
  where version = '20261103170000' and name = 'meeting_server_jobs';
commit;
