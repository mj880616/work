begin;
-- 20261111142100_meeting_join_jobs의 짝 되돌리기. 함수 2개 → 새 표 1개(색인·정책·참조 포함) → 이번 기록 1행 순서로만 지운다.
-- 지우면 잇기·합치기 작업 기록과 함께 '합치기 전 글'·이은 전문 사본이 사라진다(그 뒤로는 [합치기 전 글로 되돌리기]·[되돌리기]를 쓸 수 없다).
-- 보고 글(이미 이어 붙인 회의 결과·회의록 전문)·자료·할 일 연결·녹음 작업·소리 파일(Drive)·휴지통에 들어간 보고는 그대로다.
-- 지우기 전에 화면과 Edge meeting-transcribe를 이 표를 쓰지 않는 판으로 되돌린다. 진행 중(queued·running) 작업이 있으면 멈춘다(끝나거나 실패로 정리한 뒤 다시).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 자동으로 돌지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261111142100' and name = 'meeting_join_jobs') <> 1 then
    raise exception 'MEETING_JOIN_JOBS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meeting_join_jobs where status in ('queued', 'running')) then
    raise exception 'MEETING_JOIN_JOBS_ROLLBACK_BLOCKED: join job in progress';
  end if;
end
$$;

drop function public.app_meeting_join_undo(uuid, text);
drop function public.app_meeting_join_apply(uuid);
drop table public.app_meeting_join_jobs;

delete from supabase_migrations.schema_migrations
  where version = '20261111142100' and name = 'meeting_join_jobs';
commit;
