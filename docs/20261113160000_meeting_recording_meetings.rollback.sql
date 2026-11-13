begin;
-- 20261113160000_meeting_recording_meetings의 짝 되돌리기. 새 표 1개(색인·참조 포함) → 이번 기록 1행 순서로만 지운다.
-- 지우면 '어느 회의 녹음인지' 기록만 사라진다. 녹음 조각·합친 녹음 파일(Drive)·자료실 자료·이미 회의자료에 붙은 녹음은 그대로다.
-- 그 뒤로 끊긴 녹음을 [이어서 저장]하면 회의에는 붙지 않고 자료실 '회의 녹음' 폴더에만 저장된다(이 변경 전과 같음).
-- 지우기 전에 Edge meeting-transcribe를 이 표를 쓰지 않는 판(되돌리기 ref)으로 먼저 되돌린다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 자동으로 돌지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261113160000' and name = 'meeting_recording_meetings') <> 1 then
    raise exception 'MEETING_RECORDING_MEETINGS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_meeting_recording_meetings;

delete from supabase_migrations.schema_migrations
  where version = '20261113160000' and name = 'meeting_recording_meetings';
commit;
