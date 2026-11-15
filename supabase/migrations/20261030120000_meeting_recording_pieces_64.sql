begin;
-- MTG-녹음1분조각 DB (요청함 2026-10-30 11:15 '녹음 조각 간격 5분 → 1분', 명진 결정 '같이'(노트북·폰 앱 공통 서버)).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 20261029200000_meeting_recordings(녹음 구간 표) 적용 뒤. Edge meeting-transcribe 새 판(1분 조각) 배포 전에 적용한다.
--
-- 무엇: 녹음 구간 한 행에 담을 수 있는 조각 수 검사(app_meeting_recordings_pieces_check) 하나만 바꾼다(지우고 같은 이름으로 다시 만듦).
--   조각 수 상한 16 → 64(59분 구간 = 1분 조각 59개 + 멈출 때 1개 + 여유). 나머지 조건(빈 값 없음·1차원·Drive id 모양)은 그대로.
--   새 표·새 칸·새 권한 없음. 기존 행(조각 16개 이하)은 모두 새 검사도 통과한다(넓히기만).
-- 권한: 표 grant·정책·RLS·함수·트리거·색인 변경 없음(작업공간 소유자 읽기 정책 하나, service_role 정한 칸만 넣기·고치기 그대로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meeting_recordings in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030120000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261029200000' and name = 'meeting_recordings') <> 1
     or to_regclass('public.app_meeting_recordings') is null
     -- 조각 검사 1개, 검증됨, 상한 16(64 아님). 쓰기 요청 = 표 소유자로 돌아 information_schema가 행을 본다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_meeting_recordings'::regclass
         and conname = 'app_meeting_recordings_pieces_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_meeting_recordings_pieces_check'
           and check_clause ~ 'cardinality\(piece_ids\) <= 16\M' and check_clause ~ 'array_ndims' and check_clause !~ '<= 64') <> 1
     -- 이미 16개 넘는 행은 없다(17번째 칸이 빈 행만).
     or exists (select 1 from public.app_meeting_recordings where piece_ids[17] is not null)
     -- RLS 켜짐, anon·PUBLIC 권한 없음, 정책 하나(authenticated 소유자 읽기).
     or not (select relrowsecurity from pg_class where oid = 'public.app_meeting_recordings'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_meeting_recordings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meeting_recordings'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meeting_recordings'::regclass) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.app_meeting_recordings'::regclass and polname = 'meeting_recordings_owner_read'
         and polcmd = 'r' and polpermissive and polroles = array['authenticated'::regrole]::oid[]) then
    raise exception 'MEETING_RECORDING_PIECES_64_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_meeting_recordings drop constraint app_meeting_recordings_pieces_check;
alter table public.app_meeting_recordings
  add constraint app_meeting_recordings_pieces_check check (
    cardinality(piece_ids) <= 64
    and array_position(piece_ids, null) is null
    and (cardinality(piece_ids) = 0
      or (array_ndims(piece_ids) = 1
        and array_to_string(piece_ids, '/') ~ '^[A-Za-z0-9_-]{10,200}(/[A-Za-z0-9_-]{10,200})*$')));

-- 사후 확인: 권한 경계 그대로, 조각 검사 1개가 검증된 상한 64. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_meeting_recordings'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_meeting_recordings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meeting_recordings'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meeting_recordings'::regclass) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_meeting_recordings'::regclass
         and conname = 'app_meeting_recordings_pieces_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_meeting_recordings_pieces_check'
           and check_clause ~ 'cardinality\(piece_ids\) <= 64\M' and check_clause ~ 'array_position' and check_clause ~ 'array_ndims') <> 1 then
    raise exception 'MEETING_RECORDING_PIECES_64_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030120000', 'meeting_recording_pieces_64', array['MTG-녹음1분조각 DB: app_meeting_recordings_pieces_check allows up to 64 pieces per segment (1-minute pieces), no grants/policies/functions']);
commit;
