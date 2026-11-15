begin;
-- MTG-노트북녹음 1단계 DB. 노트북 Web2 [녹음]의 녹음 구간 한 개 = 한 행(설계: docs/design/laptop-recording.md).
-- 녹음 중 5분마다 올린 조각의 Drive 위치(순서대로)·합친 크기·길이·진행 상태만 둔다. 다 합친 구간은 기존 전사 작업 표
-- (app_meeting_transcribe_jobs) 한 행이 되고, 전사·사용량·회의에 붙이기는 기존 Edge meeting-transcribe 길을 그대로 쓴다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 두지 않는 것: 소리 자체·전사 글·요약. 소리는 명진 Drive '웹2/회의자료/회의 녹음'(조각은 그 아래 '녹음 조각')에만 있다.
--
-- 권한: 새 표 1개만. 기존 표의 권한·정책·칸은 건드리지 않는다(전사 작업 표에는 참조만 건다).
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만 읽기. 넣기·고치기·지우기 없음.
--   service_role(Edge meeting-transcribe만 씀): 넣기(칸 5개) + 읽기 + 진행 칸 고치기(칸 9개). 지우기 없음.
--   anon·PUBLIC: 없음.
-- 같은 작업공간에서 '녹음 중' 구간은 한 개만(부분 유일 색인). 한 녹음(session_id)의 구간 번호는 겹치지 않는다.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029200000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_meeting_transcribe_jobs') is null
     or to_regclass('public.app_meeting_recordings') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'MEETING_RECORDINGS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  session_id uuid not null,
  segment_no integer not null,
  status text not null default 'recording',
  error_code text,
  mime_type text not null,
  piece_ids text[] not null default '{}',
  size_bytes bigint not null default 0,
  duration_sec integer,
  job_id uuid references public.app_meeting_transcribe_jobs(id) on delete set null,
  pieces_trashed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_meeting_recordings_status_check check (status in ('recording', 'closed', 'combined', 'empty', 'failed')),
  constraint app_meeting_recordings_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  constraint app_meeting_recordings_segment_check check (segment_no between 1 and 24),
  constraint app_meeting_recordings_mime_check check (mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4')),
  constraint app_meeting_recordings_pieces_check check (
    cardinality(piece_ids) <= 16
    and array_position(piece_ids, null) is null
    and (cardinality(piece_ids) = 0
      or (array_ndims(piece_ids) = 1
        and array_to_string(piece_ids, '/') ~ '^[A-Za-z0-9_-]{10,200}(/[A-Za-z0-9_-]{10,200})*$'))),
  constraint app_meeting_recordings_size_check check (size_bytes between 0 and 104857600),
  constraint app_meeting_recordings_duration_check check (duration_sec is null or duration_sec between 1 and 3600),
  constraint app_meeting_recordings_segment_unique unique (session_id, segment_no)
);
create index app_meeting_recordings_ws_idx on public.app_meeting_recordings(workspace_id, created_at desc);
create unique index app_meeting_recordings_one_open_idx on public.app_meeting_recordings(workspace_id)
  where status = 'recording';

alter table public.app_meeting_recordings enable row level security;
revoke all on table public.app_meeting_recordings from public, anon, authenticated, service_role;

grant select on table public.app_meeting_recordings to authenticated;
grant select on table public.app_meeting_recordings to service_role;
grant insert (workspace_id, created_by, session_id, segment_no, mime_type)
  on table public.app_meeting_recordings to service_role;
grant update (status, error_code, piece_ids, size_bytes, duration_sec, job_id, pieces_trashed_at, closed_at, updated_at)
  on table public.app_meeting_recordings to service_role;

create policy meeting_recordings_owner_read on public.app_meeting_recordings for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated는 읽기만,
-- service_role은 넣기·고치기를 정한 칸만·지우기 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_meeting_recordings'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('service_role', t, 'session_id', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'piece_ids', 'insert')
     or has_column_privilege('service_role', t, 'job_id', 'insert')
     or not has_column_privilege('service_role', t, 'piece_ids', 'update')
     or not has_column_privilege('service_role', t, 'job_id', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or has_column_privilege('service_role', t, 'created_by', 'update')
     or has_column_privilege('service_role', t, 'session_id', 'update')
     or has_column_privilege('service_role', t, 'segment_no', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid])) then
    raise exception 'MEETING_RECORDINGS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029200000', 'meeting_recordings', array['MTG-노트북녹음 1단계: app_meeting_recordings (owner read, service_role column insert/update + select, no delete, one open recording per workspace)']);
commit;
