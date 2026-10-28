begin;
-- MTG-녹음초안 2단계 DB. 회의 녹음 파일 → 전사(Gemini) 작업 한 건 = 한 행. 진행 상태('올림 → 진행 중 → 끝/실패')와
-- 녹음 원본의 Drive 위치·크기·길이, 붙인 회의, 휴지통 이동 시각만 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 두지 않는 것: 전사 글(원문)·AI 답·요약. 전사 글은 Edge meeting-transcribe가 화면에 한 번 돌려주고, 화면이 기존
--   '전사 글 → 회의 기록 초안' 흐름으로 회의 기록(app_meetings)에만 넣는다. 사용량(토큰)은 기존 app_ai_external_usage에
--   ref 'mtg-<작업 id>'로 한 행씩 넣는다(새 칸 없음, 홈 'AI 사용량' 줄이 그대로 셈).
--
-- 권한: 새 표 1개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만 읽기. 넣기·고치기·지우기 없음.
--   service_role(Edge meeting-transcribe만 씀): 넣기(칸 8개) + 읽기 + 진행 칸 고치기(칸 8개). 지우기 없음.
--   anon·PUBLIC: 없음.
-- 같은 작업공간에서 '진행 중'은 한 건만(부분 유일 색인). 붙이지 않은 녹음의 30일 뒤 휴지통 이동은 Edge가 부를 때마다 정리한다.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029070000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_meeting_transcribe_jobs') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'MEETING_TRANSCRIBE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_meeting_transcribe_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  status text not null default 'uploaded',
  error_code text,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  duration_sec integer,
  model text,
  meeting_id uuid references public.app_meetings(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_meeting_transcribe_jobs_status_check check (status in ('uploaded', 'running', 'done', 'failed')),
  constraint app_meeting_transcribe_jobs_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  constraint app_meeting_transcribe_jobs_drive_check check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint app_meeting_transcribe_jobs_name_check check (char_length(file_name) between 1 and 255),
  constraint app_meeting_transcribe_jobs_mime_check check (mime_type ~ '^(audio|video)/[a-z0-9.+-]{1,60}$'),
  constraint app_meeting_transcribe_jobs_size_check check (size_bytes between 1 and 104857600),
  constraint app_meeting_transcribe_jobs_duration_check check (duration_sec is null or duration_sec between 1 and 36000),
  constraint app_meeting_transcribe_jobs_model_check check (model is null or model ~ '^[a-z0-9][a-z0-9._-]{0,63}$')
);
create index app_meeting_transcribe_jobs_ws_idx on public.app_meeting_transcribe_jobs(workspace_id, created_at desc);
create unique index app_meeting_transcribe_jobs_one_running_idx on public.app_meeting_transcribe_jobs(workspace_id)
  where status = 'running';

alter table public.app_meeting_transcribe_jobs enable row level security;
revoke all on table public.app_meeting_transcribe_jobs from public, anon, authenticated, service_role;

grant select on table public.app_meeting_transcribe_jobs to authenticated;
grant select on table public.app_meeting_transcribe_jobs to service_role;
grant insert (workspace_id, created_by, status, drive_file_id, file_name, mime_type, size_bytes, duration_sec)
  on table public.app_meeting_transcribe_jobs to service_role;
grant update (status, error_code, model, meeting_id, started_at, finished_at, trashed_at, updated_at)
  on table public.app_meeting_transcribe_jobs to service_role;

create policy meeting_transcribe_jobs_owner_read on public.app_meeting_transcribe_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated는 읽기만,
-- service_role은 넣기·고치기를 정한 칸만·지우기 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_meeting_transcribe_jobs'::regclass;
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
     or not has_column_privilege('service_role', t, 'drive_file_id', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'meeting_id', 'insert')
     or not has_column_privilege('service_role', t, 'status', 'update')
     or not has_column_privilege('service_role', t, 'meeting_id', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or has_column_privilege('service_role', t, 'drive_file_id', 'update')
     or has_column_privilege('service_role', t, 'created_by', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid])) then
    raise exception 'MEETING_TRANSCRIBE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029070000', 'meeting_transcribe_jobs', array['MTG-녹음초안 2단계: app_meeting_transcribe_jobs (owner read, service_role column insert/update + select, no delete, one running per workspace)']);
commit;
