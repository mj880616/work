begin;
-- JOURNAL-일기원드라이브 1단계 DB (설계: docs/design/diary-onedrive.md 5절). 새 표 2개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_onedrive_connections: 원드라이브 연결 1행(작업공간당 1개) = 갱신 토큰 + 사진을 읽을 폴더 하나.
--     토큰이 들어 있으므로 authenticated·anon·PUBLIC에는 어떤 권한도 주지 않는다(정책 없음 = 화면에서는 읽지도 못함).
--     읽고 쓰는 곳은 Edge 함수 onedrive-photos(service_role) 하나뿐이다. 기존 Google Drive 연결(public_policy_drive_config)과 같은 방식이다.
--  2) app_diary_stars: 일기 사진 ☆ 표시(별표). 원드라이브 사진과 직접 올린 사진 모두 한 표에 둔다. 사진 파일은 여기 없고 "어느 사진인지"만 적는다.
--     owner만 읽기·넣기·지우기(private.app_is_workspace_owner), 고치기 권한 없음. anon·PUBLIC·service_role 권한 없음.
-- 안 하는 것: 함수·트리거·기존 표 변경. 화면은 아직 이 표를 쓰지 않으므로 지금 일기 화면은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026140000')
     or to_regclass('public.app_onedrive_connections') is not null
     or to_regclass('public.app_diary_stars') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'DIARY_ONEDRIVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_onedrive_connections (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  refresh_token text not null,
  scope text not null,
  folder_id text,
  folder_name text,
  folder_path text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_onedrive_connections_token_check check (char_length(refresh_token) between 8 and 4096),
  constraint app_onedrive_connections_scope_check check (char_length(scope) between 1 and 300 and scope !~* 'readwrite|\.all'),
  constraint app_onedrive_connections_folder_check check (
    (folder_id is null and folder_name is null and folder_path is null)
    or (folder_id is not null and folder_name is not null and folder_path is not null
      and char_length(folder_id) between 1 and 200 and char_length(folder_name) between 1 and 400 and char_length(folder_path) between 1 and 2000))
);

alter table public.app_onedrive_connections enable row level security;
revoke all on table public.app_onedrive_connections from public, anon, authenticated, service_role;
grant select, delete on table public.app_onedrive_connections to service_role;
grant insert (workspace_id, refresh_token, scope, folder_id, folder_name, folder_path, connected_at, updated_at)
  on table public.app_onedrive_connections to service_role;
grant update (refresh_token, scope, folder_id, folder_name, folder_path, connected_at, updated_at)
  on table public.app_onedrive_connections to service_role;

create table public.app_diary_stars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  item_key text not null,
  taken_day date not null,
  created_at timestamptz not null default now(),
  constraint app_diary_stars_source_check check (source in ('onedrive', 'upload')),
  constraint app_diary_stars_key_check check (char_length(item_key) between 1 and 300),
  constraint app_diary_stars_unique unique (workspace_id, source, item_key)
);
create index app_diary_stars_day_idx on public.app_diary_stars(workspace_id, taken_day);

alter table public.app_diary_stars enable row level security;
revoke all on table public.app_diary_stars from public, anon, authenticated, service_role;
grant select, delete on table public.app_diary_stars to authenticated;
grant insert (workspace_id, source, item_key, taken_day) on table public.app_diary_stars to authenticated;

create policy diary_stars_owner_all on public.app_diary_stars for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: 두 표 모두 RLS 켜짐, anon·PUBLIC 권한 없음, 연결 표는 authenticated 권한·정책 없음, 별표 표는 owner 정책 하나(authenticated),
-- 별표 표 service_role 권한 없음, 연결 표 service_role은 지우기·넣기·고치기 칸만. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_class where oid in ('public.app_onedrive_connections'::regclass, 'public.app_diary_stars'::regclass) and relrowsecurity) <> 2
     or exists (select 1 from pg_class where oid in ('public.app_onedrive_connections'::regclass, 'public.app_diary_stars'::regclass)
         and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_onedrive_connections'::regclass, 'public.app_diary_stars'::regclass)
         and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_onedrive_connections', 'select,insert,update,delete,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_onedrive_connections', 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid = 'public.app_onedrive_connections'::regclass) <> 0
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_stars'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_stars'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or has_table_privilege('authenticated', 'public.app_diary_stars', 'update')
     or has_any_column_privilege('authenticated', 'public.app_diary_stars', 'update')
     or has_table_privilege('service_role', 'public.app_diary_stars', 'select,insert,update,delete')
     or has_any_column_privilege('service_role', 'public.app_diary_stars', 'select,insert,update,references')
     or has_table_privilege('service_role', 'public.app_onedrive_connections', 'insert,update')
     or not has_table_privilege('service_role', 'public.app_onedrive_connections', 'select,delete') then
    raise exception 'DIARY_ONEDRIVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026140000', 'diary_onedrive_db', array['JOURNAL-일기원드라이브 1단계: app_onedrive_connections (service_role only, no authenticated/anon access) + app_diary_stars (owner RLS, no update, no anon)']);
commit;
