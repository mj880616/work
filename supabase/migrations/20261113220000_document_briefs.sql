begin;
-- BRIEF-브리핑룸 PR ①(DB만, S61-45). 설계 docs/design/brief-room.md 3절, 시안 docs/design/mockups/brief-room.html(#2542).
-- 자료 하나의 브리핑 작업 = 한 행. 서버(Edge document-actions 브리핑 길)가 글 읽기 → 조각 정리 → 합치기를 한 단계씩 이어 가고,
-- 진행·결과(다섯 칸 브리핑)를 이 행에 둔다. 끝까지 읽은 글(source_text)은 작업 중에만 두고 끝나면 비운다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 권한(서버 정리 작업 표 20261103170000과 같은 모양): 새 표 1개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만 읽기. 넣기·고치기·지우기 없음(화면이 브리핑 결과를 직접 쓰지 못함).
--   service_role(Edge document-actions 브리핑 길만 씀): 읽기 + 넣기(정한 칸) + 진행 칸 고치기(정한 칸). 지우기 없음.
--   anon·PUBLIC: 없음.
-- 같은 자료(document_id)에 진행 중 작업은 하나만(부분 유일 색인). 자료 행이 지워지면 브리핑 행도 지운다(on delete cascade).
-- 안 하는 것: 함수·트리거·예약 실행(pg_cron)·기존 표·기존 자료 변경. 읽생기 표는 건드리지 않는다.
-- 짝: docs/20261113220000_document_briefs.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113220000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_document_briefs') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'DOCUMENT_BRIEFS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_document_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  document_id uuid not null references public.app_documents(id) on delete cascade,
  source_file_id text,
  source_md5 text,
  status text not null default 'queued',
  stage text not null default 'read',
  step_no integer not null default 0,
  step_total integer not null default 0,
  page_count integer,
  source_text text,
  parts jsonb not null default '[]'::jsonb,
  brief jsonb,
  model text,
  error_code text,
  lease_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_document_briefs_status_check check (status in ('queued', 'running', 'done', 'failed')),
  constraint app_document_briefs_stage_check check (stage in ('read', 'chunk', 'merge', 'done')),
  constraint app_document_briefs_steps_check check (
    step_no between 0 and 1000 and step_total between 0 and 1000 and attempts between 0 and 10000
    and (page_count is null or page_count between 0 and 5000)),
  constraint app_document_briefs_source_check check (
    (source_file_id is null or source_file_id ~ '^[A-Za-z0-9_-]{10,200}$')
    and (source_md5 is null or source_md5 ~ '^[0-9a-f]{32}$')),
  constraint app_document_briefs_text_check check (source_text is null or char_length(source_text) <= 600000),
  constraint app_document_briefs_parts_check check (jsonb_typeof(parts) = 'array' and octet_length(parts::text) <= 1000000),
  constraint app_document_briefs_brief_check check (brief is null or (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 60000)),
  constraint app_document_briefs_model_check check (model is null or model ~ '^[A-Za-z0-9._:-]{1,80}$'),
  constraint app_document_briefs_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);
create index app_document_briefs_scope_idx on public.app_document_briefs(workspace_id, created_at desc);
create index app_document_briefs_document_idx on public.app_document_briefs(document_id, created_at desc);
create unique index app_document_briefs_one_running_idx on public.app_document_briefs(document_id)
  where status in ('queued', 'running');

alter table public.app_document_briefs enable row level security;
revoke all on table public.app_document_briefs from public, anon, authenticated, service_role;

grant select on table public.app_document_briefs to authenticated;
grant select on table public.app_document_briefs to service_role;
grant insert (workspace_id, created_by, document_id, source_file_id, source_md5, status, stage, step_no, step_total)
  on table public.app_document_briefs to service_role;
grant update (status, stage, step_no, step_total, page_count, source_text, parts, brief, model, error_code,
              lease_until, attempts, started_at, finished_at, updated_at)
  on table public.app_document_briefs to service_role;

create policy document_briefs_owner_read on public.app_document_briefs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated는 읽기만,
-- service_role은 넣기·고치기를 정한 칸만·지우기 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_document_briefs'::regclass;
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
     or not has_column_privilege('service_role', t, 'document_id', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'brief', 'insert')
     or not has_column_privilege('service_role', t, 'brief', 'update')
     or not has_column_privilege('service_role', t, 'lease_until', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or has_column_privilege('service_role', t, 'created_by', 'update')
     or has_column_privilege('service_role', t, 'document_id', 'update')
     or has_column_privilege('service_role', t, 'source_file_id', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or (select count(*) from public.app_document_briefs) <> 0 then
    raise exception 'DOCUMENT_BRIEFS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261113220000', 'document_briefs', array['BRIEF-브리핑룸: app_document_briefs (owner read RLS, service_role listed-column insert/update, no delete)']);
commit;
