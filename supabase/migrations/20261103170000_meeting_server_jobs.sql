begin;
-- REC-서버정리·MTG-첨부녹음전사 DB(S49-2, 설계 docs/design/meeting-transcript-server.md 4·8절).
-- 녹음 한 건(또는 회의자료에 붙은 소리 파일 하나)의 '서버 정리' 작업 = 한 행. 화면을 닫아도 서버(Edge meeting-transcribe)가
-- 합치기 → 구간 전사 → 요약을 한 단계씩 이어 가고, 단계·진행·결과(전사 전문·요약 초안)를 이 행에 둔다.
-- 기존 두 표(app_meeting_recordings 구간, app_meeting_transcribe_jobs 파일)는 그대로 쓰고 한 줄도 바꾸지 않는다.
-- 전사 전문을 서버에 두는 것은 명진 11/03 11:34 지시('전사 전문 저장해도돼. 이건 내 지시다').
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 권한: 새 표 1개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만 읽기. 넣기·고치기·지우기 없음.
--   service_role(Edge meeting-transcribe만 씀): 읽기 + 넣기(정한 칸) + 진행 칸 고치기(정한 칸). 지우기 없음.
--   anon·PUBLIC: 없음.
-- 같은 녹음(session_id)·같은 붙은 파일(source_file_id)에 진행 중 작업은 하나만(부분 유일 색인).
-- 안 하는 것: 함수·트리거·예약 실행(pg_cron)·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103170000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_meeting_recordings') is null
     or to_regclass('public.app_meeting_transcribe_jobs') is null
     or to_regclass('public.app_meeting_server_jobs') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'MEETING_SERVER_JOBS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_meeting_server_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  kind text not null,
  session_id uuid,
  document_id uuid references public.app_documents(id) on delete set null,
  meeting_id uuid references public.app_meetings(id) on delete set null,
  source_file_id text,
  source_md5 text,
  status text not null default 'queued',
  stage text not null default 'combine',
  step_no integer not null default 0,
  step_total integer not null default 0,
  parts jsonb not null default '[]'::jsonb,
  summary_parts jsonb not null default '[]'::jsonb,
  transcript_text text,
  draft jsonb,
  error_code text,
  lease_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_meeting_server_jobs_kind_check check (
    (kind = 'recording' and session_id is not null)
    or (kind = 'attached' and session_id is null and source_file_id is not null)),
  constraint app_meeting_server_jobs_status_check check (status in ('queued', 'running', 'done', 'failed')),
  constraint app_meeting_server_jobs_stage_check check (stage in ('combine', 'transcribe', 'summary', 'done')),
  constraint app_meeting_server_jobs_steps_check check (step_no between 0 and 1000 and step_total between 0 and 1000 and attempts between 0 and 10000),
  constraint app_meeting_server_jobs_source_check check (
    (source_file_id is null or source_file_id ~ '^[A-Za-z0-9_-]{10,200}$')
    and (source_md5 is null or source_md5 ~ '^[0-9a-f]{32}$')),
  constraint app_meeting_server_jobs_parts_check check (
    jsonb_typeof(parts) = 'array' and jsonb_typeof(summary_parts) = 'array'
    and octet_length(parts::text) <= 4000000 and octet_length(summary_parts::text) <= 1000000),
  constraint app_meeting_server_jobs_text_check check (transcript_text is null or char_length(transcript_text) <= 1000000),
  constraint app_meeting_server_jobs_draft_check check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 200000)),
  constraint app_meeting_server_jobs_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);
create index app_meeting_server_jobs_scope_idx on public.app_meeting_server_jobs(workspace_id, created_at desc);
create index app_meeting_server_jobs_reuse_idx on public.app_meeting_server_jobs(workspace_id, source_file_id, source_md5)
  where status = 'done' and kind = 'attached';
create unique index app_meeting_server_jobs_one_session_idx on public.app_meeting_server_jobs(session_id)
  where status in ('queued', 'running');
create unique index app_meeting_server_jobs_one_file_idx on public.app_meeting_server_jobs(workspace_id, source_file_id)
  where status in ('queued', 'running') and kind = 'attached';

alter table public.app_meeting_server_jobs enable row level security;
revoke all on table public.app_meeting_server_jobs from public, anon, authenticated, service_role;

grant select on table public.app_meeting_server_jobs to authenticated;
grant select on table public.app_meeting_server_jobs to service_role;
grant insert (workspace_id, created_by, kind, session_id, document_id, meeting_id, source_file_id, source_md5,
              status, stage, step_no, step_total, parts, transcript_text, draft, finished_at)
  on table public.app_meeting_server_jobs to service_role;
grant update (status, stage, step_no, step_total, parts, summary_parts, transcript_text, draft, error_code,
              lease_until, attempts, started_at, finished_at, opened_at, meeting_id, updated_at)
  on table public.app_meeting_server_jobs to service_role;

create policy meeting_server_jobs_owner_read on public.app_meeting_server_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated는 읽기만,
-- service_role은 넣기·고치기를 정한 칸만·지우기 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_meeting_server_jobs'::regclass;
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
     or has_column_privilege('service_role', t, 'lease_until', 'insert')
     or not has_column_privilege('service_role', t, 'lease_until', 'update')
     or not has_column_privilege('service_role', t, 'draft', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or has_column_privilege('service_role', t, 'created_by', 'update')
     or has_column_privilege('service_role', t, 'kind', 'update')
     or has_column_privilege('service_role', t, 'session_id', 'update')
     or has_column_privilege('service_role', t, 'source_file_id', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or (select count(*) from public.app_meeting_server_jobs) <> 0 then
    raise exception 'MEETING_SERVER_JOBS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103170000', 'meeting_server_jobs', array['REC-서버정리: app_meeting_server_jobs (owner read RLS, service_role listed-column insert/update, no delete)']);
commit;
