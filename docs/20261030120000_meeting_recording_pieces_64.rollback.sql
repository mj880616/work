begin;
-- 20261030120000_meeting_recording_pieces_64의 짝 되돌리기. 조각 검사 상한을 16으로 되돌리고 이번 기록 1행만 지운다.
-- 먼저 Edge meeting-transcribe를 5분 조각 판(ref ce292d9d)으로 되돌린 뒤 실행한다(1분 판이 돌면 17번째 조각부터 막힘).
-- 조각이 16개 넘게 쌓인 구간이 하나라도 있으면 멈춘다. 녹음을 지우거나 조각을 몰래 줄여 통과시키지 않는다.
-- 그런 경우: 그 녹음 행을 어떻게 둘지 명진이 정하고 커맨드센터가 별도로 승인한 SQL로 한 뒤 다시 계획한다.
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meeting_recordings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261030120000' and name = 'meeting_recording_pieces_64') <> 1 then
    raise exception 'MEETING_RECORDING_PIECES_64_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meeting_recordings where piece_ids[17] is not null) then
    raise exception 'MEETING_RECORDING_PIECES_64_ROLLBACK_BLOCKED: segments with more than 16 pieces exist';
  end if;
end
$$;

alter table public.app_meeting_recordings drop constraint app_meeting_recordings_pieces_check;
alter table public.app_meeting_recordings
  add constraint app_meeting_recordings_pieces_check check (
    cardinality(piece_ids) <= 16
    and array_position(piece_ids, null) is null
    and (cardinality(piece_ids) = 0
      or (array_ndims(piece_ids) = 1
        and array_to_string(piece_ids, '/') ~ '^[A-Za-z0-9_-]{10,200}(/[A-Za-z0-9_-]{10,200})*$')));

delete from supabase_migrations.schema_migrations
  where version = '20261030120000' and name = 'meeting_recording_pieces_64';
commit;
