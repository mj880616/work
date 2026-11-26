begin;
-- S71-01 AUTH-구글권한나누기 ①(명진 2026-11-26 10:02 'ㄱ'): 구글 로그인 창구를 둘로 나눈다.
--   심사용 창구(지금 OAuth 클라이언트, 모든 사람: drive.file까지) / 명진 전용 창구(새 OAuth 클라이언트, 운영자 작업공간만: drive 전체).
-- 갱신 열쇠(refresh token)는 그것을 내준 창구의 client id/secret으로만 새 토큰을 받을 수 있다. 그래서 작업공간 Drive 연결마다 '어느 창구'인지 적는다.
--  새 표 public.app_drive_connection_clients(작업공간당 0~1행): workspace_id(연결 행을 가리킴, 연결이 지워지면 같이 지워짐), oauth_client('review'|'full').
--  행이 없으면 'review'(지금까지의 모든 연결 = 심사용 창구). 토큰·이름·메일 칸은 없다.
--  RLS 켬·정책 없음·anon·authenticated·PUBLIC 권한 없음. service_role(Edge)만 읽기·넣기(정한 칸)·고치기(정한 칸)·지우기.
-- 기존 표 app_drive_connections는 바꾸지 않는다(칸·권한·정책 그대로). 기존 연결 행 내용도 읽거나 바꾸지 않는다.
-- 안 하는 것: 기존 표·함수·정책·권한 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 짝: docs/20261126100000_drive_connection_clients.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261104233000' and name = 'workspace_drive_connections') <> 1
     or to_regclass('public.app_drive_connections') is null
     or to_regclass('public.app_drive_connection_clients') is not null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_drive_connections') and not attisdropped
           and attname = 'workspace_id' and atttypid = 'uuid'::regtype) <> 1
     or not (select relrowsecurity from pg_class where oid = to_regclass('public.app_drive_connections')) then
    raise exception 'DRIVE_CONNECTION_CLIENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_drive_connection_clients (
  workspace_id uuid primary key references public.app_drive_connections(workspace_id) on delete cascade,
  oauth_client text not null,
  updated_at timestamptz not null default now(),
  constraint app_drive_connection_clients_kind check (oauth_client in ('review', 'full'))
);
alter table public.app_drive_connection_clients enable row level security;
revoke all on table public.app_drive_connection_clients from public, anon, authenticated, service_role;
grant select, delete on table public.app_drive_connection_clients to service_role;
grant insert (workspace_id, oauth_client, updated_at) on table public.app_drive_connection_clients to service_role;
grant update (oauth_client, updated_at) on table public.app_drive_connection_clients to service_role;

do $$
declare
  t regclass := 'public.app_drive_connection_clients'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_policy where polrelid = t)
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or not has_table_privilege('service_role', t, 'delete')
     or has_table_privilege('service_role', t, 'insert,update,truncate,references,trigger')
     or not has_column_privilege('service_role', t, 'oauth_client', 'insert')
     or not has_column_privilege('service_role', t, 'oauth_client', 'update')
     or has_column_privilege('service_role', t, 'workspace_id', 'update')
     or (select count(*) from pg_constraint where conrelid = t and contype = 'f' and confdeltype = 'c'
           and confrelid = 'public.app_drive_connections'::regclass) <> 1
     or not (select relrowsecurity from pg_class where oid = 'public.app_drive_connections'::regclass) then
    raise exception 'DRIVE_CONNECTION_CLIENTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126100000', 'drive_connection_clients', array['S71-01 AUTH-구글권한나누기: new table app_drive_connection_clients (workspace_id fk app_drive_connections on delete cascade, oauth_client review|full; RLS on, no policies, no anon/authenticated/PUBLIC, service_role select/delete + column insert/update); app_drive_connections unchanged']);
commit;
