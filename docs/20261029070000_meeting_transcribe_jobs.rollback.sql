begin;
-- 20261029070000_meeting_transcribe_jobs의 짝 되돌리기. 새 표 1개(색인·정책 포함)와 이번 기록 1행만 지운다.
-- 지우면 전사 작업 기록(진행 상태·녹음 Drive 위치)이 사라진다. 녹음 원본은 명진 Drive에 그대로 남는다(지우지 않음).
-- 회의 기록(app_meetings)·전사 사용량(app_ai_external_usage의 'mtg-' 행)은 그대로다.
-- 지우기 전에 화면(전사 버튼)을 이전 판으로 되돌리고 Edge meeting-transcribe를 쓰지 않는 상태로 둔다
-- (함수는 표가 없으면 모든 요청에 실패를 돌려줄 뿐 다른 기능에는 영향이 없다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029070000' and name = 'meeting_transcribe_jobs') <> 1 then
    raise exception 'MEETING_TRANSCRIBE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_meeting_transcribe_jobs;

delete from supabase_migrations.schema_migrations
  where version = '20261029070000' and name = 'meeting_transcribe_jobs';
commit;
