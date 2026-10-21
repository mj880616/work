begin;
-- TASK-파일붙이기: Google 할 일에 붙인 Drive 파일의 연결 표 1개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- 할 일 원본은 Google Tasks, 파일 원본은 Google Drive(자료실 폴더 아래 "할 일 첨부")다. 이 표는 "어느 할 일에 어느 파일"만 둔다.
-- 파일 내용·Drive 폴더 ID·토큰은 넣지 않는다. 할 일을 지우면 google-tasks Edge가 이 연결만 지우고 Drive 파일은 남긴다.
-- owner만 읽고 쓴다(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한과 공개 정책은 없다.
-- google-tasks Edge는 이 표를 caller JWT(authenticated)로만 읽고 쓴다(app_record_links와 같은 경로). 고치기(update)는 없다.
-- 짝: docs/20261022003000_task_attachments.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022003000')
     or to_regclass('public.app_task_attachments') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TASK_ATTACHMENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 할 일 첨부 연결. 한 Drive 파일은 한 행(같은 파일을 두 할 일에 붙이지 않음). 할 일당 개수 상한(10)은 Edge가 지킨다.
create table public.app_task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  google_task_id text not null,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint app_task_attachments_task_check check (google_task_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  constraint app_task_attachments_file_check check (drive_file_id ~ '^[A-Za-z0-9_-]{1,255}$'),
  constraint app_task_attachments_name_check check (
    char_length(file_name) between 1 and 255 and file_name !~ '[[:cntrl:]]'),
  constraint app_task_attachments_mime_check check (mime_type ~ '^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$'),
  constraint app_task_attachments_size_check check (size_bytes between 1 and 104857600),
  constraint app_task_attachments_file_key unique (workspace_id, drive_file_id)
);
create index app_task_attachments_task_idx on public.app_task_attachments(workspace_id, google_task_id, created_at);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만(id·created_at은 DB가 정함).
alter table public.app_task_attachments enable row level security;
revoke all on table public.app_task_attachments from public, anon, authenticated, service_role;
grant select, delete on table public.app_task_attachments to authenticated;
grant insert (workspace_id, google_task_id, drive_file_id, file_name, mime_type, size_bytes)
  on table public.app_task_attachments to authenticated;

create policy task_attachments_owner_all on public.app_task_attachments for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, update 권한 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_task_attachments'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_task_attachments'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_task_attachments'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_task_attachments', 'update')
     or has_any_column_privilege('authenticated', 'public.app_task_attachments', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_task_attachments'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_task_attachments'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'TASK_ATTACHMENTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022003000', 'task_attachments', array['TASK-파일붙이기: app_task_attachments (Google task -> Drive file link), owner RLS, authenticated select/insert(columns)/delete only, no anon/service_role']);
commit;
