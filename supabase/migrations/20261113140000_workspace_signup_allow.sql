begin;
-- MULTI-가입명단(★급★, 명진 11/13 13:51·13:54): 가입 문을 '명단에 적은 사람만' 열 수 있게 한다. 이 파일은 스위치를 켜지 않고 명단에 아무도 넣지 않는다.
-- 1) 새 표 public.app_workspace_signup_allow(email, kind): RLS 켬·정책 없음·API 역할 권한 없음 → SQL로만 읽고 쓴다(스위치 표와 같은 잠금).
--    kind 'operator' = 운영자(지금 역할 트리거 안에 고정된 메일, 이 파일이 운영 정의에서 옮겨 적는다 — 저장소에는 메일이 없다),
--    kind 'self_start' = 스스로 작업공간을 만들 수 있는 사람(CC가 SQL로 한 줄씩 넣는다).
-- 2) 역할 트리거 함수 private.app_enforce_workspace_member_role(): 고정 메일 비교를 명단 표 조회로 바꾼다.
--    운영자 → owner(지금과 같음). self_start 명단 사람 → 그 작업공간에 구성원이 아직 하나도 없을 때(새로 만든 자기 작업공간)만 owner.
--    그 밖은 지금과 같다(viewer·author·editor 밖이면 author). UPDATE 쪽은 한 글자도 바꾸지 않는다.
-- 3) public.app_workspace_start(): 이미 owner 행이 있으면 그대로 돌려주고(지금과 같음), 없을 때는 본인 메일(auth.users, 확인된 메일)이
--    self_start 명단에 있어야만 만든다. 아니면 42501 SIGNUP_NOT_LISTED(아무것도 안 만듦).
-- 4) public.app_workspace_start_status(): open = 스위치 켜짐 그리고(본인이 명단에 있음 또는 이미 owner). 명단 밖 사람에게는 [내 작업공간 만들기]가 안 보인다.
-- 안 하는 것: 스위치 켜기, 명단에 사람 넣기, Auth 트리거, 운영자 기능 표, 기존 정책·표 권한, rtw 객체.
-- 짝: docs/20261113140000_workspace_signup_allow.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113140000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261105183000' and name = 'workspace_self_start') <> 1
     or to_regclass('public.app_workspace_signup_allow') is not null
     or to_regprocedure('private.app_enforce_workspace_member_role()') is null
     or (select count(*) from pg_catalog.regexp_matches(pg_catalog.pg_get_functiondef('private.app_enforce_workspace_member_role()'::regprocedure), 'if v_email = ''[^'']+'' then', 'g')) <> 1 then
    raise exception 'WORKSPACE_SIGNUP_ALLOW_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_workspace_signup_allow (
  email text primary key,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint app_workspace_signup_allow_kind check (kind in ('operator', 'self_start')),
  constraint app_workspace_signup_allow_email check (email = lower(btrim(email)) and position('@' in email) > 1)
);
alter table public.app_workspace_signup_allow enable row level security;
revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;

insert into public.app_workspace_signup_allow (email, kind)
select lower(m[1]), 'operator'
from pg_catalog.regexp_match(pg_catalog.pg_get_functiondef('private.app_enforce_workspace_member_role()'::regprocedure), 'if v_email = ''([^'']+)'' then') m
where m is not null;

create or replace function private.app_enforce_workspace_member_role()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_email text;
  v_actor_role text;
begin
  if tg_op = 'INSERT' then
    select lower(email) into v_email from auth.users where id = new.user_id;
    if exists (select 1 from public.app_workspace_signup_allow a where a.email = v_email and a.kind = 'operator') then
      new.role := 'owner';
    elsif new.role = 'owner'
      and exists (select 1 from public.app_workspace_signup_allow a where a.email = v_email and a.kind = 'self_start')
      and not exists (select 1 from public.app_workspace_members m where m.workspace_id = new.workspace_id) then
      new.role := 'owner';
    elsif new.role not in ('viewer','author','editor') then
      new.role := 'author';
    end if;
    return new;
  end if;

  select role into v_actor_role
  from public.app_workspace_members
  where workspace_id = old.workspace_id and user_id = auth.uid();

  if old.user_id = auth.uid() or old.role = 'owner' then
    new.role := old.role;
  elsif v_actor_role = 'owner' then
    if new.role not in ('admin','editor','author','viewer') then new.role := old.role; end if;
  elsif v_actor_role = 'admin' then
    if old.role = 'admin' or new.role not in ('editor','author','viewer') then new.role := old.role; end if;
  else
    new.role := old.role;
  end if;

  return new;
end
$$;

create or replace function public.app_workspace_start_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'open', exists (select 1 from public.app_workspace_signup s where s.id = 1 and s.open)
      and (select auth.uid()) is not null
      and (exists (select 1 from public.app_workspace_signup_allow a join auth.users u on pg_catalog.lower(u.email) = a.email
                    where u.id = (select auth.uid()) and a.kind = 'self_start' and u.email_confirmed_at is not null)
        or exists (select 1 from public.app_workspace_members m where m.user_id = (select auth.uid()) and m.role = 'owner')),
    'has_workspace', (select auth.uid()) is not null
      and exists (select 1 from public.app_workspace_members m where m.user_id = (select auth.uid()) and m.role = 'owner'))
$$;

create or replace function public.app_workspace_start()
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
  if not exists (select 1 from public.app_workspace_signup_allow a join auth.users u on pg_catalog.lower(u.email) = a.email
                  where u.id = v_user and a.kind = 'self_start' and u.email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'SIGNUP_NOT_LISTED';
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

revoke all on function private.app_enforce_workspace_member_role() from public, anon, authenticated, service_role;
revoke all on function public.app_workspace_start_status() from public, anon, authenticated, service_role;
revoke all on function public.app_workspace_start() from public, anon, authenticated, service_role;
grant execute on function public.app_workspace_start_status() to authenticated;
grant execute on function public.app_workspace_start() to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_workspace_signup_allow'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_workspace_signup_allow'::regclass)
     or has_table_privilege('anon', 'public.app_workspace_signup_allow', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_workspace_signup_allow', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_workspace_signup_allow', 'select,insert,update,delete')
     or (select count(*) from public.app_workspace_signup_allow where kind = 'operator') <> 1
     or (select count(*) from public.app_workspace_signup_allow where kind = 'self_start') <> 0
     or (select count(*) from public.app_workspace_signup where id = 1 and not open) <> 1
     or pg_catalog.pg_get_functiondef('private.app_enforce_workspace_member_role()'::regprocedure) ~ '@'
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_workspace_start()'), to_regprocedure('public.app_workspace_start_status()'))
           and prosecdef and proconfig = array['search_path=""']) <> 2
     or has_function_privilege('anon', 'public.app_workspace_start()', 'execute')
     or has_function_privilege('anon', 'public.app_workspace_start_status()', 'execute')
     or has_function_privilege('service_role', 'public.app_workspace_start()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_workspace_start()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_workspace_start_status()', 'execute') then
    raise exception 'WORKSPACE_SIGNUP_ALLOW_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261113140000', 'workspace_signup_allow', array['MULTI signup allow-list: new table app_workspace_signup_allow (email, kind operator|self_start; RLS on, no policies, no API privileges; written only by SQL); operator email moved from the role trigger body into the table; private.app_enforce_workspace_member_role() reads the table (operator -> owner as before; self_start -> owner only on a workspace with no members yet); app_workspace_start() also requires the caller''s confirmed email on the self_start list (else SIGNUP_NOT_LISTED); app_workspace_start_status() open only for listed callers or existing owners; switch stays off, no one listed']);
commit;
