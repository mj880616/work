begin;
-- MULTI-노조사용자 ②-4 (S50-19): 로그인한 본인에게만 작업공간 1개 + 본인 owner 행 1개를 만드는 서버 함수. 설계: docs/design/multi-user-audit.md 8절 ②-4 행.
-- 가입 문은 닫힌 채로 둔다: 새 표 public.app_workspace_signup(1행, open=false)이 서버 스위치다. 이 파일은 스위치를 켜지 않는다.
--   표: RLS 켬, 정책 없음, anon·authenticated·service_role 표 권한 없음 → 화면·API·Edge로는 읽지도 쓰지도 못한다. 켜기·끄기는 SQL로만(커맨드센터, ②-2 운영 반영·D4 뒤).
-- 새 함수 둘(SECURITY DEFINER, 빈 search_path, 인자 없음, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--   public.app_workspace_start_status()  로그인 화면용. {open: 스위치 켜짐, has_workspace: 내 owner 행 있음}만 돌려준다(남의 정보 없음).
--   public.app_workspace_start()         스위치가 꺼져 있으면 42501 SIGNUP_CLOSED로 거절(아무것도 안 만듦).
--     켜져 있으면 auth.uid() 본인 한 사람만: 이미 owner 행이 있으면 그 작업공간을 그대로 돌려주고(created=false),
--     없을 때만 작업공간 1개 + 본인 owner 행 1개 + (없으면) 빈 프로필 1행을 만든다(created=true).
--     같은 사람의 동시 호출은 트랜잭션 잠금(pg_advisory_xact_lock, 사람별 열쇠)으로 한 줄로 세워 두 번 눌러도 하나만 생긴다.
--     화면이 보낸 사용자·작업공간·이름·역할 값은 받지 않는다(인자 없음). service_role도 부를 수 없으므로 남 대신 만드는 길이 없다.
--     owner 행을 넣은 뒤 그 작업공간의 구성원 행이 정확히 '본인 owner 1행'이 아니면(운영 전용 역할 트리거가 역할을 바꾼 경우 등) 예외로 전부 취소한다.
-- 안 하는 것: Auth 가입 트리거(RTW와 Auth 공유), 운영자 기능 행(app_operator_features) 만들기, 기존 표·정책·권한·트리거·함수 변경, 스위치 켜기, rtw 객체.
-- 짝: docs/20261105183000_workspace_self_start.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261105183000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261105131500' and name = 'profile_view_prefs_org_order') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_profiles') is null
     or to_regclass('public.app_workspace_signup') is not null
     or to_regprocedure('public.app_workspace_start()') is not null
     or to_regprocedure('public.app_workspace_start_status()') is not null then
    raise exception 'WORKSPACE_START_PREREQUISITE_CHANGED; stop';
  end if;
  -- 함수가 넣는 칸(작업공간 id·slug·name, 구성원 workspace_id·user_id·role, 프로필 user_id) 밖에 기본값 없는 필수 칸이 있으면 멈춘다.
  if exists (select 1 from pg_attribute a
              where a.attrelid in (to_regclass('public.app_workspaces'), to_regclass('public.app_workspace_members'), to_regclass('public.app_profiles'))
                and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = ''
                and not ((a.attrelid = to_regclass('public.app_workspaces') and a.attname in ('id', 'slug', 'name'))
                      or (a.attrelid = to_regclass('public.app_workspace_members') and a.attname in ('workspace_id', 'user_id', 'role'))
                      or (a.attrelid = to_regclass('public.app_profiles') and a.attname = 'user_id')))
     or (select count(*) from pg_attribute a
          where not a.attisdropped
            and ((a.attrelid = to_regclass('public.app_workspaces') and a.attname = 'id' and a.atttypid = 'uuid'::regtype)
              or (a.attrelid = to_regclass('public.app_workspaces') and a.attname in ('slug', 'name') and a.atttypid = 'text'::regtype)
              or (a.attrelid = to_regclass('public.app_workspace_members') and a.attname in ('workspace_id', 'user_id') and a.atttypid = 'uuid'::regtype)
              or (a.attrelid = to_regclass('public.app_workspace_members') and a.attname = 'role' and a.atttypid = 'text'::regtype)
              or (a.attrelid = to_regclass('public.app_profiles') and a.attname = 'user_id' and a.atttypid = 'uuid'::regtype))) <> 7 then
    raise exception 'WORKSPACE_START_COLUMNS_CHANGED; stop';
  end if;
end
$$;

create table public.app_workspace_signup (
  id smallint primary key,
  open boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_workspace_signup_single_row check (id = 1)
);
alter table public.app_workspace_signup enable row level security;
revoke all on table public.app_workspace_signup from public, anon, authenticated, service_role;
insert into public.app_workspace_signup (id, open) values (1, false);

create function public.app_workspace_start_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'open', exists (select 1 from public.app_workspace_signup s where s.id = 1 and s.open),
    'has_workspace', (select auth.uid()) is not null
      and exists (select 1 from public.app_workspace_members m where m.user_id = (select auth.uid()) and m.role = 'owner'))
$$;

create function public.app_workspace_start()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.app_workspace_signup s where s.id = 1 and s.open) then
    raise exception using errcode = '42501', message = 'SIGNUP_CLOSED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_workspace_start:' || v_user::text, 0));
  select m.workspace_id into v_workspace
    from public.app_workspace_members m
   where m.user_id = v_user and m.role = 'owner'
   order by m.workspace_id
   limit 1;
  if v_workspace is not null then
    return pg_catalog.jsonb_build_object('ok', true, 'created', false, 'workspace_id', v_workspace);
  end if;
  v_workspace := pg_catalog.gen_random_uuid();
  insert into public.app_workspaces (id, slug, name)
  values (v_workspace, 'ws-' || pg_catalog.replace(v_workspace::text, '-', ''), '내 작업공간');
  insert into public.app_workspace_members (workspace_id, user_id, role)
  values (v_workspace, v_user, 'owner');
  if (select count(*) from public.app_workspace_members m where m.workspace_id = v_workspace) <> 1
     or not exists (select 1 from public.app_workspace_members m
                     where m.workspace_id = v_workspace and m.user_id = v_user and m.role = 'owner') then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_OWNER_NOT_SET';
  end if;
  if not exists (select 1 from public.app_profiles p where p.user_id = v_user) then
    insert into public.app_profiles (user_id) values (v_user);
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'created', true, 'workspace_id', v_workspace);
end
$$;

revoke all on function public.app_workspace_start_status() from public, anon, authenticated, service_role;
revoke all on function public.app_workspace_start() from public, anon, authenticated, service_role;
grant execute on function public.app_workspace_start_status() to authenticated;
grant execute on function public.app_workspace_start() to authenticated;

-- 사후 확인: 스위치 표는 RLS 켜짐·정책 없음·API 역할 권한 없음·꺼진 1행. 함수 둘은 DEFINER·authenticated만 실행. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_workspace_signup'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_workspace_signup'::regclass)
     or has_table_privilege('anon', 'public.app_workspace_signup', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_workspace_signup', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_workspace_signup', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_workspace_signup) <> 1
     or (select count(*) from public.app_workspace_signup where id = 1 and not open) <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_workspace_start()'), to_regprocedure('public.app_workspace_start_status()'))
           and prosecdef and proconfig = array['search_path=""']) <> 2
     or has_function_privilege('anon', 'public.app_workspace_start()', 'execute')
     or has_function_privilege('anon', 'public.app_workspace_start_status()', 'execute')
     or has_function_privilege('service_role', 'public.app_workspace_start()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_workspace_start()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_workspace_start_status()', 'execute')
     or exists (select 1 from pg_proc where oid in (to_regprocedure('public.app_workspace_start()'), to_regprocedure('public.app_workspace_start_status()'))
           and proacl::text ~ '(^|[{,])=') then
    raise exception 'WORKSPACE_START_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261105183000', 'workspace_self_start', array['S50-19 MULTI 2-4: new table app_workspace_signup (single row id=1, open=false; RLS on, no policies, no anon/authenticated/service_role privileges; switch written only by SQL); SECURITY DEFINER functions with empty search_path, no arguments, authenticated execute only: public.app_workspace_start_status() returns own open/has_workspace, public.app_workspace_start() refuses SIGNUP_CLOSED unless the switch is on, else returns the caller''s existing owner workspace or creates exactly one workspace + one owner row for auth.uid() (+ empty profile if missing) under a per-user advisory transaction lock; no auth trigger, no operator feature rows, no change to existing tables, policies, grants, triggers or functions']);
commit;
