begin;
-- MULTI-노조사용자 ②-2 (S49-53, 명진 11/04 "같이 시작 오늘 밤에"): 사람별(작업공간별) Google Drive 연결. 설계: docs/design/multi-user-audit.md 8절.
-- 지금은 프로젝트 전체에 Drive 연결이 하나(public_policy_drive_config id=1의 refresh token)라 어느 작업공간이 올리든 명진 Drive로 간다.
-- 새 표 public.app_drive_connections(작업공간당 1행): RLS 켬, 정책 없음, anon·authenticated 권한 없음, service_role만 칸을 정해 읽고 쓴다(Edge만).
--   화면·API로는 읽지도 쓰지도 못한다. refresh token은 서버에만 있고 응답에 싣지 않는다(_shared/workspace-drive-token.ts).
-- 명진 연결 옮기기(같은 트랜잭션): 'calls' 허용 작업공간(운영자, 정확히 1개)에 id=1의 refresh token을 그대로 복사한 1행을 넣는다.
--   고정 id·이름·메일을 쓰지 않는다. 조건이 어긋나면 멈추고 아무것도 바꾸지 않는다.
-- 안 하는 것: public_policy_drive_config 변경(앱 client id/secret과 운영자 전용 함수·Web1이 계속 읽음, Contract는 뒤 단계),
--   기존 표·정책·권한·함수 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체, 가입 열기·작업공간 만들기(②-4).
-- 짝: docs/20261104233000_workspace_drive_connections.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104233000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.public_policy_drive_config') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_drive_connections') is not null then
    raise exception 'WORKSPACE_DRIVE_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'WORKSPACE_DRIVE_OPERATOR_NOT_SINGLE; stop';
  end if;
  if (select count(*) from public.public_policy_drive_config
        where id = 1 and coalesce(char_length(google_refresh_token), 0) between 8 and 4096) <> 1 then
    raise exception 'WORKSPACE_DRIVE_SOURCE_TOKEN_MISSING; stop';
  end if;
end
$$;

create table public.app_drive_connections (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  google_refresh_token text not null,
  full_drive boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_drive_connections_token_check check (char_length(google_refresh_token) between 8 and 4096)
);

alter table public.app_drive_connections enable row level security;
revoke all on table public.app_drive_connections from public, anon, authenticated, service_role;
grant select, delete on table public.app_drive_connections to service_role;
grant insert (workspace_id, google_refresh_token, full_drive, connected_at, updated_at)
  on table public.app_drive_connections to service_role;
grant update (google_refresh_token, full_drive, connected_at, updated_at)
  on table public.app_drive_connections to service_role;

-- 명진 연결 옮기기: 운영자 작업공간 1행. full_drive=true(지금 연결은 사진 출처용 drive 권한까지 받은 연결).
insert into public.app_drive_connections (workspace_id, google_refresh_token, full_drive)
select f.workspace_id, c.google_refresh_token, true
  from public.app_operator_features f
  cross join public.public_policy_drive_config c
 where f.feature = 'calls' and c.id = 1;

-- 사후 확인: RLS 켜짐·정책 없음·anon·authenticated·PUBLIC 권한 없음, 행은 운영자 작업공간 1행이고 id=1과 같은 열쇠. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_drive_connections'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_drive_connections'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_drive_connections'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_drive_connections', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_drive_connections', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_drive_connections) <> 1
     or (select count(*) from public.app_drive_connections d
           join public.app_operator_features f on f.workspace_id = d.workspace_id and f.feature = 'calls'
           join public.public_policy_drive_config c on c.id = 1 and c.google_refresh_token = d.google_refresh_token) <> 1 then
    raise exception 'WORKSPACE_DRIVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104233000', 'workspace_drive_connections', array['S49-53 MULTI 2-2: new table app_drive_connections (RLS on, no policies, service_role column grants only, no anon/authenticated/PUBLIC); operator calls workspace row copied from public_policy_drive_config id=1 refresh token; public_policy_drive_config unchanged']);
commit;
