begin;
-- 20261029200000_meeting_recordings의 짝 되돌리기. 새 표 1개(색인·정책·참조 포함)와 이번 기록 1행만 지운다.
-- 지우면 녹음 구간 기록(조각 Drive 위치·진행 상태)이 사라진다. 소리 파일(조각·합친 녹음)은 명진 Drive에 그대로 남는다(지우지 않음).
-- 이미 합쳐 만든 전사 작업(app_meeting_transcribe_jobs)·회의 기록·사용량 기록은 그대로다.
-- 지우기 전에 화면([녹음] 버튼)을 이전 판으로, Edge meeting-transcribe를 이전 판으로 되돌린다
-- (녹음 길만 실패하고 기존 파일 전사 길에는 영향이 없다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029200000' and name = 'meeting_recordings') <> 1 then
    raise exception 'MEETING_RECORDINGS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_meeting_recordings;

delete from supabase_migrations.schema_migrations
  where version = '20261029200000' and name = 'meeting_recordings';
commit;
