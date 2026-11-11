begin;
-- S58-11 REC-한회의로잇기 PR-1(DB만). 설계 docs/design/rec-join.md 3-2절·4절 PR-1 줄.
-- 두 번 녹음한 회의를 한 보고로 잇기·이미 저장한 두 보고 합치기 한 번 = 한 행. '합치기 전 글'도 이 행에 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 새 표 public.app_meeting_join_jobs 1개 + 색인 5개 + 서버 전용 함수 2개.
--   기존 표의 칸·제약·정책·권한은 한 줄도 바꾸지 않는다(참조만).
-- 권한(서버 정리 작업 표 20261103170000과 같은 모양):
--   authenticated: 작업공간 owner(private.app_is_workspace_owner)만 읽기. 넣기·고치기·지우기 없음.
--   service_role(Edge meeting-transcribe만 씀): 읽기 + 넣기(정한 칸) + 진행 칸 고치기(정한 칸). 지우기 없음.
--     합치기 전 글(before_*)·재료 칸·적용/되돌리기 기록 칸(applied_at·moved·kept_result·undone_at)은 고치기 권한 없음 — 아래 함수만 쓴다.
--   anon·PUBLIC: 없음.
-- 함수 2개(security definer, search_path 빈칸, 실행권은 service_role만 — PUBLIC·anon·authenticated 회수):
--   public.app_meeting_join_apply(p_job uuid)            보고 글 바꾸기 + 녹음 연결(합치기면 자료·할 일 연결 옮기기 + 없어지는 보고 휴지통)을 한 번에.
--   public.app_meeting_join_undo(p_job uuid, p_scope text) 회의 결과를 합치기 전 글로(before) / 이은 글로(joined) / 통째로 되돌리기(all).
--   둘 다 id만 받고 넣을 행은 DB 행에서 직접 만든다. 부르는 Edge가 로그인·소유를 확인하고, 함수는 작업 만든 사람이 지금도 그 작업공간 owner인지·
--   같은 작업공간·휴지통 아님·[회의] 칸·글이 시작 때 그대로인지를 SQL로 다시 확인한다. 어긋나면 고정 글자 예외로 전체 취소(보고는 그대로):
--   JOIN_REPORT_CHANGED · JOIN_REPORT_GONE · JOIN_SOURCE_CHANGED · JOIN_SOURCE_GONE · JOIN_ALREADY_JOINED · JOIN_NOT_APPLIED. 글 내용은 예외·반환값에 싣지 않는다.
--   없어질 보고의 글 지문(source_result_sha·source_notes_sha) = 그 글(없으면 빈 글)의 UTF-8 SHA-256, 소문자 16진수 64자.
-- 안 하는 것: 트리거·예약 실행·기존 표 칸/제약/정책/권한 변경·기존 자료 변경. 읽생기 표는 건드리지 않는다.
-- 짝: docs/20261111142100_meeting_join_jobs.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261111142100')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_record_links') is null
     or to_regclass('public.app_meeting_server_jobs') is null
     or to_regclass('public.app_meeting_transcribe_jobs') is null
     or to_regclass('public.app_meeting_join_jobs') is not null
     or to_regprocedure('public.app_meeting_join_apply(uuid)') is not null
     or to_regprocedure('public.app_meeting_join_undo(uuid,text)') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_attribute where not attisdropped and (
           (attrelid = to_regclass('public.app_meetings')
             and attname in ('workspace_id', 'project_id', 'transcript_text', 'notes', 'activity_kind', 'deleted_at', 'updated_at'))
           or (attrelid = to_regclass('public.app_record_links')
             and attname in ('workspace_id', 'meeting_id', 'google_task_id'))
           or (attrelid = to_regclass('public.app_meeting_server_jobs')
             and attname in ('workspace_id', 'status', 'meeting_id', 'opened_at'))
           or (attrelid = to_regclass('public.app_meeting_transcribe_jobs')
             and attname in ('workspace_id', 'status', 'meeting_id', 'trashed_at', 'drive_file_id', 'file_name', 'mime_type', 'size_bytes'))
           or (attrelid = to_regclass('public.app_workspace_members')
             and attname in ('workspace_id', 'user_id', 'role'))
           or (attrelid = to_regclass('public.app_documents')
             and attname in ('workspace_id', 'project_id', 'meeting_id', 'title', 'category', 'source', 'document_date', 'description',
               'tags', 'drive_url', 'file_id', 'file_name', 'mime_type', 'file_size', 'visibility', 'uploaded_by', 'auto_classified')))) <> 42 then
    raise exception 'MEETING_JOIN_JOBS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_meeting_join_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  mode text not null,
  target_meeting_id uuid not null references public.app_meetings(id) on delete cascade,
  source_job_id uuid references public.app_meeting_server_jobs(id) on delete set null,
  source_meeting_id uuid references public.app_meetings(id) on delete set null,
  source_text text,
  source_record_jobs uuid[] not null default '{}'::uuid[],
  source_result_sha text,
  source_notes_sha text,
  before_result text,
  before_notes text,
  status text not null default 'queued',
  stage text not null default 'summary',
  step_no integer not null default 0,
  step_total integer not null default 0,
  summary_parts jsonb not null default '[]'::jsonb,
  transcript_text text,
  draft jsonb,
  result_text text,
  error_code text,
  lease_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  applied_at timestamptz,
  moved jsonb,
  kept_result text,
  undone_at timestamptz,
  seen_at timestamptz,
  candidates_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_meeting_join_jobs_mode_check check (mode in ('job', 'report', 'text')),
  constraint app_meeting_join_jobs_status_check check (status in ('queued', 'running', 'done', 'failed', 'undone')),
  constraint app_meeting_join_jobs_stage_check check (stage in ('summary', 'apply', 'done')),
  constraint app_meeting_join_jobs_steps_check check (step_no between 0 and 1000 and step_total between 0 and 1000 and attempts between 0 and 10000),
  constraint app_meeting_join_jobs_source_check check (
    target_meeting_id is distinct from source_meeting_id
    and cardinality(source_record_jobs) <= 20 and array_position(source_record_jobs, null) is null
    and (source_result_sha is null or source_result_sha ~ '^[0-9a-f]{64}$')
    and (source_notes_sha is null or source_notes_sha ~ '^[0-9a-f]{64}$')),
  constraint app_meeting_join_jobs_text_check check (
    (transcript_text is null or char_length(transcript_text) <= 1000000)
    and (source_text is null or char_length(source_text) <= 1000000)
    and (before_notes is null or char_length(before_notes) <= 1000000)
    and (before_result is null or char_length(before_result) <= 1000000)
    and (result_text is null or char_length(result_text) <= 1000000)),
  constraint app_meeting_join_jobs_parts_check check (
    jsonb_typeof(summary_parts) = 'array' and octet_length(summary_parts::text) <= 1000000),
  constraint app_meeting_join_jobs_draft_check check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 200000)),
  constraint app_meeting_join_jobs_moved_check check (moved is null or (jsonb_typeof(moved) = 'object' and octet_length(moved::text) <= 1000000)),
  constraint app_meeting_join_jobs_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);
create index app_meeting_join_jobs_scope_idx on public.app_meeting_join_jobs(workspace_id, created_at desc);
create index app_meeting_join_jobs_target_idx on public.app_meeting_join_jobs(target_meeting_id, applied_at desc);
-- 같은 보고에 진행 중 하나 / 같은 녹음 결과에 진행 중·끝남 하나 / 같은 없어질 보고에 진행 중 하나.
create unique index app_meeting_join_jobs_one_target_idx on public.app_meeting_join_jobs(target_meeting_id)
  where status in ('queued', 'running');
create unique index app_meeting_join_jobs_one_source_job_idx on public.app_meeting_join_jobs(source_job_id)
  where status in ('queued', 'running', 'done');
create unique index app_meeting_join_jobs_one_source_meeting_idx on public.app_meeting_join_jobs(source_meeting_id)
  where status in ('queued', 'running');

alter table public.app_meeting_join_jobs enable row level security;
revoke all on table public.app_meeting_join_jobs from public, anon, authenticated, service_role;

grant select on table public.app_meeting_join_jobs to authenticated;
grant select on table public.app_meeting_join_jobs to service_role;
grant insert (workspace_id, created_by, mode, target_meeting_id, source_job_id, source_meeting_id, source_text, source_record_jobs,
              source_result_sha, source_notes_sha, before_result, before_notes,
              status, stage, step_no, step_total, summary_parts, transcript_text)
  on table public.app_meeting_join_jobs to service_role;
grant update (status, stage, step_no, step_total, summary_parts, transcript_text, draft, result_text, error_code,
              lease_until, attempts, started_at, finished_at, seen_at, candidates_closed_at, updated_at)
  on table public.app_meeting_join_jobs to service_role;

create policy meeting_join_jobs_owner_read on public.app_meeting_join_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 적용: 작업 행·보고 행을 잠그고 다시 확인한 뒤 한 번에 쓴다. 두 번 불러도 한 번만(applied_at).
create function public.app_meeting_join_apply(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $apply$
declare
  j public.app_meeting_join_jobs%rowtype;
  m public.app_meetings%rowtype;
  s public.app_meetings%rowtype;
  sj public.app_meeting_server_jobs%rowtype;
  r public.app_meeting_transcribe_jobs%rowtype;
  rec_id uuid;
  new_doc uuid;
  made_docs uuid[] := '{}'::uuid[];
  linked_record_jobs uuid[] := '{}'::uuid[];
  moved_docs uuid[] := '{}'::uuid[];
  moved_links uuid[] := '{}'::uuid[];
  moved_server_jobs uuid[] := '{}'::uuid[];
  moved_record_jobs uuid[] := '{}'::uuid[];
  server_job_linked boolean := false;
  server_job_opened boolean := false;
begin
  -- 1. 작업 행 잠금. 적용할 차례(running·apply·아직 적용 안 됨·넣을 두 글이 있음)가 아니면 아무것도 안 하고 지금 상태만 돌려준다.
  select * into j from public.app_meeting_join_jobs where id = p_job for update;
  if not found then
    return pg_catalog.jsonb_build_object('applied', false, 'found', false);
  end if;
  if j.status <> 'running' or j.stage <> 'apply' or j.applied_at is not null
     or coalesce(j.result_text, '') = '' or coalesce(j.transcript_text, '') = '' then
    return pg_catalog.jsonb_build_object('applied', false, 'found', true, 'status', j.status, 'stage', j.stage,
      'applied_at', j.applied_at);
  end if;
  -- 2. 작업을 만든 사람이 지금도 그 작업공간의 owner인지.
  if not exists (select 1 from public.app_workspace_members wm
      where wm.workspace_id = j.workspace_id and wm.user_id = j.created_by and wm.role = 'owner') then
    raise exception 'JOIN_REPORT_GONE';
  end if;
  -- 3. 보고 잠금(두 보고면 id 순서로 먼저 잠가 서로 기다리지 않게). 같은 작업공간·휴지통 아님·[회의] 칸·두 글이 시작 때 그대로.
  perform 1 from public.app_meetings x
    where x.id in (j.target_meeting_id, j.source_meeting_id) and x.workspace_id = j.workspace_id
    order by x.id for update;
  select * into m from public.app_meetings
    where id = j.target_meeting_id and workspace_id = j.workspace_id for update;
  if not found or m.deleted_at is not null then
    raise exception 'JOIN_REPORT_GONE';
  end if;
  if coalesce(m.activity_kind, 'meeting') <> 'meeting'
     or coalesce(m.transcript_text, '') <> coalesce(j.before_result, '')
     or coalesce(m.notes, '') <> coalesce(j.before_notes, '') then
    raise exception 'JOIN_REPORT_CHANGED';
  end if;
  -- 4. 보고 글 바꾸기. 회의명·일시·참석인원·차수·종류·연결은 건드리지 않는다.
  update public.app_meetings
    set transcript_text = j.result_text, notes = j.transcript_text, updated_at = pg_catalog.now()
    where id = m.id;
  -- 5. 녹음 잇기(job·text): 붙일 녹음 전사 작업을 하나씩 잠그고 확인한 뒤, 그 행에서 직접 자료 행을 만든다.
  if j.mode in ('job', 'text') then
    foreach rec_id in array j.source_record_jobs loop
      select * into r from public.app_meeting_transcribe_jobs
        where id = rec_id and workspace_id = j.workspace_id for update;
      if not found or r.status <> 'done' or r.trashed_at is not null then
        raise exception 'JOIN_SOURCE_GONE';
      end if;
      if r.meeting_id is null then
        insert into public.app_documents (workspace_id, project_id, meeting_id, title, category, source, document_date,
            description, tags, drive_url, file_id, file_name, mime_type, file_size, visibility, uploaded_by, auto_classified)
          values (m.workspace_id, m.project_id, m.id,
            coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.regexp_replace(r.file_name, '\.[^.]+$', ''), '^\s+|\s+$', '', 'g'), ''), r.file_name),
            '회의자료', null, null, null, array['회의자료', '회의녹음']::text[],
            'https://drive.google.com/file/d/' || r.drive_file_id || '/view', r.drive_file_id, r.file_name, r.mime_type, r.size_bytes,
            'private', j.created_by, false)
          returning id into new_doc;
        update public.app_meeting_transcribe_jobs set meeting_id = m.id where id = r.id;
        made_docs := made_docs || new_doc;
        linked_record_jobs := linked_record_jobs || r.id;
      elsif r.meeting_id <> m.id then
        raise exception 'JOIN_ALREADY_JOINED';
      end if;
    end loop;
  end if;
  if j.mode = 'job' then
    select * into sj from public.app_meeting_server_jobs
      where id = j.source_job_id and workspace_id = j.workspace_id for update;
    if not found or sj.status <> 'done' then
      raise exception 'JOIN_SOURCE_GONE';
    end if;
    if sj.meeting_id is not null and sj.meeting_id <> m.id then
      raise exception 'JOIN_ALREADY_JOINED';
    end if;
    server_job_linked := sj.meeting_id is null;
    server_job_opened := sj.opened_at is null;
    update public.app_meeting_server_jobs
      set meeting_id = m.id, opened_at = coalesce(opened_at, pg_catalog.now())
      where id = sj.id;
  end if;
  -- 6. 보고 합치기(report): 없어지는 보고를 확인하고, 자료·할 일 연결·녹음 작업을 옮긴 뒤 휴지통으로(지우지 않는다).
  if j.mode = 'report' then
    select * into s from public.app_meetings
      where id = j.source_meeting_id and workspace_id = j.workspace_id for update;
    if not found or s.deleted_at is not null or s.id = m.id then
      raise exception 'JOIN_SOURCE_GONE';
    end if;
    if coalesce(s.activity_kind, 'meeting') <> 'meeting'
       or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(s.transcript_text, ''), 'UTF8')), 'hex')
            is distinct from j.source_result_sha
       or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(s.notes, ''), 'UTF8')), 'hex')
            is distinct from j.source_notes_sha then
      raise exception 'JOIN_SOURCE_CHANGED';
    end if;
    with moved_rows as (
      update public.app_documents d set meeting_id = m.id
        where d.meeting_id = s.id and d.workspace_id = j.workspace_id
        returning d.id)
    select coalesce(pg_catalog.array_agg(moved_rows.id), '{}'::uuid[]) into moved_docs from moved_rows;
    -- 할 일 연결만 옮긴다. 같은 할 일이 이미 고른 보고에 붙어 있으면 그대로 둔다(겹쳐 생기지 않게).
    with moved_rows as (
      update public.app_record_links l set meeting_id = m.id
        where l.meeting_id = s.id and l.workspace_id = j.workspace_id and l.google_task_id is not null
          and not exists (select 1 from public.app_record_links t
            where t.meeting_id = m.id and t.google_task_id = l.google_task_id)
        returning l.id)
    select coalesce(pg_catalog.array_agg(moved_rows.id), '{}'::uuid[]) into moved_links from moved_rows;
    with moved_rows as (
      update public.app_meeting_server_jobs g set meeting_id = m.id
        where g.meeting_id = s.id and g.workspace_id = j.workspace_id
        returning g.id)
    select coalesce(pg_catalog.array_agg(moved_rows.id), '{}'::uuid[]) into moved_server_jobs from moved_rows;
    with moved_rows as (
      update public.app_meeting_transcribe_jobs g set meeting_id = m.id
        where g.meeting_id = s.id and g.workspace_id = j.workspace_id
        returning g.id)
    select coalesce(pg_catalog.array_agg(moved_rows.id), '{}'::uuid[]) into moved_record_jobs from moved_rows;
    update public.app_meetings set deleted_at = pg_catalog.now()
      where id = s.id and deleted_at is null;
  end if;
  -- 7. 작업 행: 적용 기록 + 작업용 사본 비우기(합친 전문은 남긴다 — 보고가 옛 글로 덮였을 때 되찾는 원본).
  update public.app_meeting_join_jobs
    set applied_at = pg_catalog.now(), status = 'done', stage = 'done', finished_at = pg_catalog.now(),
        updated_at = pg_catalog.now(), lease_until = null, error_code = null,
        summary_parts = '[]'::jsonb, source_text = null,
        moved = pg_catalog.jsonb_build_object(
          'docs_made', pg_catalog.to_jsonb(made_docs), 'record_jobs_linked', pg_catalog.to_jsonb(linked_record_jobs),
          'server_job_linked', server_job_linked, 'server_job_opened', server_job_opened,
          'docs', pg_catalog.to_jsonb(moved_docs), 'links', pg_catalog.to_jsonb(moved_links),
          'server_jobs', pg_catalog.to_jsonb(moved_server_jobs), 'record_jobs', pg_catalog.to_jsonb(moved_record_jobs))
    where id = j.id;
  return pg_catalog.jsonb_build_object('applied', true, 'found', true, 'status', 'done', 'stage', 'done',
    'applied_at', pg_catalog.now());
end
$apply$;
revoke all on function public.app_meeting_join_apply(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_meeting_join_apply(uuid) to service_role;

-- 되돌리기: before(회의 결과만 합치기 전 글로) / joined(회의 결과만 이은 글로) / all(통째로 — 두 글·자료·연결·없어진 보고까지).
create function public.app_meeting_join_undo(p_job uuid, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $undo$
declare
  j public.app_meeting_join_jobs%rowtype;
  m public.app_meetings%rowtype;
  s public.app_meetings%rowtype;
  made_docs uuid[];
  linked_record_jobs uuid[];
  moved_docs uuid[];
  moved_links uuid[];
  moved_server_jobs uuid[];
  moved_record_jobs uuid[];
  kept boolean := false;
begin
  if p_scope is null or p_scope not in ('before', 'joined', 'all') then
    raise exception 'JOIN_NOT_APPLIED';
  end if;
  -- 공통: 작업 행 잠금(적용됐고 통째로 되돌린 적 없음), 만든 사람이 지금도 owner, 고른 보고 잠금(같은 작업공간·휴지통 아님).
  select * into j from public.app_meeting_join_jobs where id = p_job for update;
  if not found or j.applied_at is null or j.undone_at is not null or j.status <> 'done' then
    raise exception 'JOIN_NOT_APPLIED';
  end if;
  if not exists (select 1 from public.app_workspace_members wm
      where wm.workspace_id = j.workspace_id and wm.user_id = j.created_by and wm.role = 'owner') then
    raise exception 'JOIN_REPORT_GONE';
  end if;
  perform 1 from public.app_meetings x
    where x.id in (j.target_meeting_id, j.source_meeting_id) and x.workspace_id = j.workspace_id
    order by x.id for update;
  select * into m from public.app_meetings
    where id = j.target_meeting_id and workspace_id = j.workspace_id for update;
  if not found or m.deleted_at is not null then
    raise exception 'JOIN_REPORT_GONE';
  end if;

  if p_scope in ('before', 'joined') then
    -- 지금 글이 두 원본 어느 것과도 다르면(사람이 직접 고친 글) 먼저 보관한다. 두 원본은 바꾸지 않는다.
    if coalesce(m.transcript_text, '') <> coalesce(j.before_result, '')
       and coalesce(m.transcript_text, '') <> coalesce(j.result_text, '') then
      kept := true;
      update public.app_meeting_join_jobs
        set kept_result = m.transcript_text, updated_at = pg_catalog.now()
        where id = j.id;
    end if;
    update public.app_meetings
      set transcript_text = case when p_scope = 'before' then j.before_result else j.result_text end,
          updated_at = pg_catalog.now()
      where id = m.id;
    return pg_catalog.jsonb_build_object('scope', p_scope, 'undone', false, 'kept', kept);
  end if;

  -- all ① 이 작업이 그 보고에 마지막으로 적용된(되돌리지 않은) 잇기 작업 ② 두 글을 사람이 고친 적 없음.
  if exists (select 1 from public.app_meeting_join_jobs o
      where o.target_meeting_id = j.target_meeting_id and o.id <> j.id
        and o.applied_at is not null and o.undone_at is null and o.applied_at >= j.applied_at)
     or coalesce(m.notes, '') <> coalesce(j.transcript_text, '')
     or (coalesce(m.transcript_text, '') <> coalesce(j.result_text, '')
         and coalesce(m.transcript_text, '') <> coalesce(j.before_result, '')) then
    raise exception 'JOIN_REPORT_CHANGED';
  end if;
  made_docs := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'docs_made', '[]'::jsonb))::uuid);
  linked_record_jobs := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'record_jobs_linked', '[]'::jsonb))::uuid);
  moved_docs := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'docs', '[]'::jsonb))::uuid);
  moved_links := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'links', '[]'::jsonb))::uuid);
  moved_server_jobs := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'server_jobs', '[]'::jsonb))::uuid);
  moved_record_jobs := array(select pg_catalog.jsonb_array_elements_text(coalesce(j.moved -> 'record_jobs', '[]'::jsonb))::uuid);

  if j.mode = 'report' then
    -- ③ 없어진 보고가 아직 휴지통에 있고, 옮긴 자료·연결 행이 아직 고른 보고에 붙어 있음.
    select * into s from public.app_meetings
      where id = j.source_meeting_id and workspace_id = j.workspace_id for update;
    if not found or s.deleted_at is null
       or (select count(*) from public.app_documents d
            where d.id = any(moved_docs) and d.meeting_id = m.id and d.workspace_id = j.workspace_id)
          <> cardinality(moved_docs)
       or (select count(*) from public.app_record_links l
            where l.id = any(moved_links) and l.meeting_id = m.id and l.workspace_id = j.workspace_id)
          <> cardinality(moved_links) then
      raise exception 'JOIN_SOURCE_GONE';
    end if;
    update public.app_documents d set meeting_id = s.id
      where d.id = any(moved_docs) and d.meeting_id = m.id and d.workspace_id = j.workspace_id;
    update public.app_record_links l set meeting_id = s.id
      where l.id = any(moved_links) and l.meeting_id = m.id and l.workspace_id = j.workspace_id
        and not exists (select 1 from public.app_record_links t
          where t.meeting_id = s.id and t.google_task_id = l.google_task_id);
    update public.app_meeting_server_jobs g set meeting_id = s.id
      where g.id = any(moved_server_jobs) and g.meeting_id = m.id and g.workspace_id = j.workspace_id;
    update public.app_meeting_transcribe_jobs g set meeting_id = s.id
      where g.id = any(moved_record_jobs) and g.meeting_id = m.id and g.workspace_id = j.workspace_id;
    update public.app_meetings set deleted_at = null
      where id = s.id and deleted_at is not null;
  else
    -- 녹음 잇기: apply가 만든 자료 행만 없애고(Drive 파일은 그대로), apply가 채운 녹음 작업의 '어느 보고' 칸만 비운다.
    delete from public.app_documents d
      where d.id = any(made_docs) and d.meeting_id = m.id and d.workspace_id = j.workspace_id;
    update public.app_meeting_transcribe_jobs g set meeting_id = null
      where g.id = any(linked_record_jobs) and g.meeting_id = m.id and g.workspace_id = j.workspace_id;
    if j.mode = 'job' and coalesce((j.moved ->> 'server_job_linked')::boolean, false) then
      update public.app_meeting_server_jobs g
        set meeting_id = null,
            opened_at = case when coalesce((j.moved ->> 'server_job_opened')::boolean, false) then null else g.opened_at end
        where g.id = j.source_job_id and g.meeting_id = m.id and g.workspace_id = j.workspace_id;
    end if;
  end if;
  update public.app_meetings
    set transcript_text = j.before_result, notes = j.before_notes, updated_at = pg_catalog.now()
    where id = m.id;
  update public.app_meeting_join_jobs
    set status = 'undone', undone_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = j.id;
  return pg_catalog.jsonb_build_object('scope', 'all', 'undone', true, 'kept', false);
end
$undo$;
revoke all on function public.app_meeting_join_undo(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_meeting_join_undo(uuid, text) to service_role;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated는 읽기만,
-- service_role은 정한 칸만 넣기·고치기(합치기 전 글·적용/되돌리기 기록 칸은 못 고침)·지우기 없음,
-- 함수 2개는 definer·search_path 빈칸·service_role만 실행. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_meeting_join_jobs'::regclass;
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
     or not has_column_privilege('service_role', t, 'target_meeting_id', 'insert')
     or not has_column_privilege('service_role', t, 'before_notes', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'applied_at', 'insert')
     or has_column_privilege('service_role', t, 'moved', 'insert')
     or has_column_privilege('service_role', t, 'kept_result', 'insert')
     or has_column_privilege('service_role', t, 'undone_at', 'insert')
     or not has_column_privilege('service_role', t, 'lease_until', 'update')
     or not has_column_privilege('service_role', t, 'result_text', 'update')
     or (select count(*) from pg_attribute where attrelid = t and not attisdropped
           and attname in ('workspace_id', 'created_by', 'mode', 'target_meeting_id', 'source_job_id', 'source_meeting_id',
             'source_text', 'source_record_jobs', 'source_result_sha', 'source_notes_sha', 'before_result', 'before_notes',
             'applied_at', 'moved', 'kept_result', 'undone_at', 'id', 'created_at')
           and has_column_privilege('service_role', t, attname, 'update')) <> 0
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or (select count(*) from pg_index where indrelid = t and indisunique and indpred is not null) <> 3
     or (select count(*) from pg_proc
           where oid in (to_regprocedure('public.app_meeting_join_apply(uuid)'), to_regprocedure('public.app_meeting_join_undo(uuid,text)'))
             and prosecdef and proconfig = array['search_path=""']
             and has_function_privilege('service_role', oid, 'execute')
             and not has_function_privilege('authenticated', oid, 'execute')
             and not has_function_privilege('anon', oid, 'execute')
             and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0)) <> 2
     or (select count(*) from public.app_meeting_join_jobs) <> 0 then
    raise exception 'MEETING_JOIN_JOBS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261111142100', 'meeting_join_jobs', array['S58-11 REC-한회의로잇기 PR-1: app_meeting_join_jobs (owner read RLS, service_role listed-column insert/update, no delete) + definer functions app_meeting_join_apply(uuid) and app_meeting_join_undo(uuid, text), execute for service_role only']);
commit;
