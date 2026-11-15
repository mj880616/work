begin;
-- 20261113140000_workspace_signup_allow의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 두 함수는 20261105183000의 정의로 돌린다. 역할 트리거 함수는 '운영자만 owner'로 돌리되, 운영자 메일은 저장소에 적지 않으므로
-- 명단 표의 operator 1행을 읽는 모양으로 둔다(동작은 적용 전과 같음). 명단 표는 지우지 않는다(운영자 메일 보관처).
-- 되돌리기 전에 스위치를 끈다: update public.app_workspace_signup set open = false, updated_at = now() where id = 1;
-- 이미 만들어진 다른 사람 작업공간·owner 행·프로필은 남는다(자료 보존). 지울지는 따로 결정한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261113140000' and name = 'workspace_signup_allow') <> 1
     or (select count(*) from public.app_workspace_signup_allow where kind = 'operator') <> 1 then
    raise exception 'WORKSPACE_SIGNUP_ALLOW_ROLLBACK_BLOCKED';
  end if;
end
$$;

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
    'open', exists (select 1 from public.app_workspace_signup s where s.id = 1 and s.open),
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

delete from supabase_migrations.schema_migrations where version = '20261113140000' and name = 'workspace_signup_allow';
commit;
