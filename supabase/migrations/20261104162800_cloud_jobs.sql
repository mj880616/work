begin;
-- FILES-통합 2-②(S49-28, 설계 docs/design/files-unified-plan.md D-5·F·J절, J-1): 클라우드 전송 작업표.
-- 사람이 시작한 복사·옮기기 한 건(파일 1개 또는 같은 클라우드 안 폴더째 1개) = app_cloud_jobs 한 줄.
-- 화면을 닫아도 서버(Edge cloud-files)가 줄을 하나씩 이어 가고(200MB 넘는 클라우드 사이 파일은 10MB 조각씩 여러 번에 나눠),
-- 진행(보낸 바이트)·상태·실패 까닭(정해 둔 말)·같은 이름 처리 결과를 이 줄에 적는다. 화면은 다시 열면 이 표를 읽어 이어 보인다.
-- 이어 올리기 자리(원드라이브 upload session URL·구글 resumable URI — 그 주소 자체가 쓰기 권한)와 해시 계산 중간값은
-- 따로 app_cloud_job_uploads에 두고 화면(authenticated)에는 아무 권한도 주지 않는다(service_role만).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 권한: 새 표 2개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   app_cloud_jobs: authenticated는 '그 작업공간 owner 그리고 files 허용'인 줄만 읽기. 넣기·고치기·지우기 없음.
--                   service_role(Edge cloud-files만 씀): 읽기 + 넣기(정한 칸) + 진행 칸 고치기(정한 칸). 지우기 없음.
--   app_cloud_job_uploads: RLS 켬, 정책 없음. authenticated·anon·PUBLIC 권한 없음. service_role 읽기·넣기·고치기·지우기.
--   anon·PUBLIC: 둘 다 없음.
-- 안 하는 것: 함수·트리거·예약 실행(pg_cron)·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104162800')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102160000' and name = 'cloud_files_index') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_cloud_items') is null
     or to_regclass('public.app_cloud_jobs') is not null
     or to_regclass('public.app_cloud_job_uploads') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null then
    raise exception 'CLOUD_JOBS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_cloud_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  kind text not null,
  origin text not null default 'cloud',
  src_source text not null,
  src_id text,
  dest_source text not null,
  dest_parent text,
  name text not null,
  result_name text,
  same_name text,
  is_folder boolean not null default false,
  size_bytes bigint,
  mime text,
  src_hash text,
  big boolean not null default false,
  status text not null default 'queued',
  sent_bytes bigint not null default 0,
  result_item_id text,
  kept_original boolean not null default false,
  error_code text,
  lease_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_cloud_jobs_kind_check check (kind in ('copy', 'move')),
  -- origin cloud = 클라우드끼리(서버가 이어 감). device = 기기(노트북·폰)가 끼는 전송(2-④·3단계에서 씀, 서버는 이어 가지 않음).
  constraint app_cloud_jobs_origin_check check (
    (origin = 'cloud' and src_source in ('od', 'gd') and src_id is not null)
    or (origin = 'device' and src_source = 'dev' and src_id is null)),
  constraint app_cloud_jobs_source_check check (dest_source in ('od', 'gd')),
  constraint app_cloud_jobs_id_check check (
    (src_id is null or src_id ~ '^[A-Za-z0-9!_.-]{1,200}$')
    and (dest_parent is null or dest_parent ~ '^[A-Za-z0-9!_.-]{1,200}$')
    and (result_item_id is null or result_item_id ~ '^[A-Za-z0-9!_.-]{1,200}$')),
  constraint app_cloud_jobs_name_check check (char_length(name) between 1 and 400
    and (result_name is null or char_length(result_name) between 1 and 400)),
  constraint app_cloud_jobs_same_name_check check (same_name is null or same_name in ('numbered', 'skipped')),
  constraint app_cloud_jobs_mime_check check (mime is null or char_length(mime) <= 200),
  constraint app_cloud_jobs_hash_check check (src_hash is null or src_hash ~ '^(md5|sha1|sha256|qx):[A-Za-z0-9+/=]{1,100}$'),
  constraint app_cloud_jobs_status_check check (status in ('queued', 'running', 'paused', 'done', 'failed', 'skipped')),
  constraint app_cloud_jobs_bytes_check check (size_bytes is null or (size_bytes >= 0 and sent_bytes between 0 and size_bytes)),
  constraint app_cloud_jobs_big_check check (not big or (size_bytes is not null and not is_folder)),
  constraint app_cloud_jobs_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  constraint app_cloud_jobs_attempts_check check (attempts between 0 and 100000)
);
create index app_cloud_jobs_scope_idx on public.app_cloud_jobs(workspace_id, created_at desc);
create index app_cloud_jobs_active_idx on public.app_cloud_jobs(workspace_id, created_at)
  where status in ('queued', 'running');

create table public.app_cloud_job_uploads (
  job_id uuid primary key references public.app_cloud_jobs(id) on delete cascade,
  upload_url text not null,
  hash_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_cloud_job_uploads_url_check check (char_length(upload_url) between 9 and 4000 and upload_url like 'https://%'),
  constraint app_cloud_job_uploads_state_check check (hash_state is null
    or (jsonb_typeof(hash_state) = 'object' and octet_length(hash_state::text) <= 2000))
);

alter table public.app_cloud_jobs enable row level security;
alter table public.app_cloud_job_uploads enable row level security;
revoke all on table public.app_cloud_jobs from public, anon, authenticated, service_role;
revoke all on table public.app_cloud_job_uploads from public, anon, authenticated, service_role;

grant select on table public.app_cloud_jobs to authenticated;
grant select on table public.app_cloud_jobs to service_role;
grant insert (workspace_id, created_by, kind, origin, src_source, src_id, dest_source, dest_parent, name, result_name, same_name,
              is_folder, size_bytes, mime, src_hash, big, status, error_code, finished_at)
  on table public.app_cloud_jobs to service_role;
grant update (status, sent_bytes, result_name, result_item_id, kept_original, error_code, lease_until, attempts,
              started_at, finished_at, updated_at)
  on table public.app_cloud_jobs to service_role;
grant select, insert, update, delete on table public.app_cloud_job_uploads to service_role;

create policy cloud_jobs_owner_read on public.app_cloud_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));

-- 사후 확인: 두 표 RLS 켜짐, 작업표 정책 1개(authenticated owner+files 읽기), 이어 올리기 표 정책 없음,
-- anon·PUBLIC 권한 없음, authenticated는 작업표 읽기만·이어 올리기 표 없음, service_role은 작업표 정한 칸만·지우기 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_cloud_jobs'::regclass; u regclass := 'public.app_cloud_job_uploads'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or not (select relrowsecurity from pg_class where oid = u)
     or exists (select 1 from pg_class where oid in (t, u) and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in (t, u) and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('anon', u, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', u, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or has_table_privilege('authenticated', u, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', u, 'select,insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('service_role', t, 'src_id', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'lease_until', 'insert')
     or has_column_privilege('service_role', t, 'sent_bytes', 'insert')
     or not has_column_privilege('service_role', t, 'sent_bytes', 'update')
     or not has_column_privilege('service_role', t, 'lease_until', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or has_column_privilege('service_role', t, 'created_by', 'update')
     or has_column_privilege('service_role', t, 'kind', 'update')
     or has_column_privilege('service_role', t, 'src_id', 'update')
     or has_column_privilege('service_role', t, 'dest_source', 'update')
     or has_column_privilege('service_role', t, 'size_bytes', 'update')
     or not has_table_privilege('service_role', u, 'select,insert,update,delete')
     or has_table_privilege('service_role', u, 'truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t
                and (polcmd <> 'r' or not polpermissive or polroles <> array['authenticated'::regrole]::oid[]))
     or exists (select 1 from pg_policy where polrelid = u)
     or (select count(*) from public.app_cloud_jobs) <> 0 then
    raise exception 'CLOUD_JOBS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104162800', 'cloud_jobs', array['S49-28 FILES-통합 2-②: app_cloud_jobs (RLS, authenticated select for workspace owner with files feature, service_role listed-column insert/update, no delete) + app_cloud_job_uploads (RLS, no policies, service_role only — resumable upload address and hash state never readable by the screen)']);
commit;
