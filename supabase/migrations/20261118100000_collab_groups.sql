begin;
-- COLLAB-묶인사람끼리공유 1단계 '묶기' PR①(DB). 설계 docs/design/collab-sharing.md 3절(#2696, 명진 결정 ①~⑭ 11/16 09:28 "추천대로"), 시안 함께쓰기 3차(#2702).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). 화면 PR②는 적용 뒤.
--
-- 무엇: 새 표 6개(묶음·멤버·초대 링크·같은 이름 들어오기 요청·만들기 시도·들어오고 나간 기록)와 함수 14개(공개 RPC 11 + private 도우미 3).
--   묶음은 두 종류: 부서 묶음(dept = 노조명+부서명), 노조 묶음(union = 노조명). 이름은 사람이 친 글 그대로(앞뒤 공백 제거·연속 공백 하나로).
--   같은 이름 비교 열쇠(name_key)는 서버에서만: 소문자·모든 공백 제거. 목록·찾기·자동완성 함수는 없다.
--   묶는 길은 둘뿐: ① 관리자가 만든 초대 링크(결정 ⑦) ② 같은 이름으로 묶음을 만들면 같은 이름 묶음 관리자에게 들어오기 요청(결정 ⑥, 관리자만 수락).
-- 보안(AGENTS.md 3절, 설계 2절 ④):
--   - 새 표 6개: RLS 켬, 정책 없음, anon·authenticated·service_role·PUBLIC 표 권한 없음(app_operator_features와 같은 방식). 읽기·쓰기는 아래 함수로만.
--   - 공개 함수: SECURITY DEFINER, search_path = '', auth.uid() 없으면 거절(42501), PUBLIC·anon·service_role 실행 회수, authenticated만 실행.
--   - workspace_id·user_id를 클라이언트에서 받지 않는다. 내 작업공간은 서버가 app_workspace_members의 owner 행에서 찾는다(읽기만).
--     group_id·member_id·request_id를 받으면 부른 사람의 멤버 여부·역할을 서버 행에서 다시 확인한다.
--   - 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다(private.app_is_workspace_owner·task12a 정책 그대로, app_workspace_members에 owner 외 행 없음).
--   - 옛 협업 표(app_invites·참석자·프로젝트 구성원 등)는 쓰지 않고 되살리지 않는다. 운영자 함수도 만들지 않는다(운영자는 개수만 — 3절 '남의 기록 안 보기').
--   - 같은 이름 요청은 있든 없든 만든 사람에게 같은 한 줄(COLLAB_GROUP_CREATED)만 돌려준다. 하루(24시간) 3번 넘으면 같은 한 줄 + 아무 일 없음.
--     요청자는 요청 표를 읽지 못한다(내 묶음 함수는 내가 관리자인 묶음에 온 요청만 돌려준다). 거절은 요청자에게 알리지 않는다.
--   - 초대 링크 글자: 무작위 uuid 둘(244비트)을 붙인 64자. 원문은 만들 때 한 번만 돌려주고 sha256 해시만 저장. 기한 7일·1명. 실패 이유는 하나(COLLAB_INVITE_UNUSABLE).
--   - 멤버에게 보이는 이름·직책은 들어갈 때(만들기·초대 수락·요청) 동의(p_agree)한 프로필 값만 복사한다. 프로필 이름이 비어 있으면 거절.
--   - 상한: 한 사람 묶음 10개, 묶음 멤버 100명, 같은 이름 요청은 한 번에 묶음 5곳, 묶음당 살아 있는 링크 20개, 요청은 14일 지나면 무효.
-- 공유 항목(app_collab_shares 등)·댓글·알림은 2단계 이후(이 파일에 없음). 폰 알림 없음(앱 안 표시만, 6단계).
-- 짝: docs/20261118100000_collab_groups.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261118100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115223000' and name = 'profile_union_department') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_profiles') is null
     or (select count(*) from pg_attribute a where not a.attisdropped and (
            (a.attrelid = 'public.app_workspace_members'::regclass and a.attname in ('workspace_id', 'user_id', 'role'))
         or (a.attrelid = 'public.app_profiles'::regclass and a.attname in ('user_id', 'display_name', 'job_title')))) <> 6
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regclass('public.app_collab_groups') is not null
     or to_regclass('public.app_collab_members') is not null
     or to_regclass('public.app_collab_invites') is not null
     or to_regclass('public.app_collab_join_requests') is not null
     or to_regclass('public.app_collab_join_attempts') is not null
     or to_regclass('public.app_collab_member_log') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'app\_collab\_%') then
    raise exception 'COLLAB_GROUPS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 표 ---------------------------------------------------------------------------------------------

create table public.app_collab_groups (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  union_name text not null,
  dept_name text,
  name_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint app_collab_groups_kind_check check (kind in ('dept', 'union')),
  constraint app_collab_groups_shape_check check (
    (kind = 'union' and dept_name is null) or (kind = 'dept' and dept_name is not null)),
  constraint app_collab_groups_union_name_check check (
    char_length(union_name) between 1 and 60 and union_name !~ '[[:cntrl:]]' and union_name ~ '[^[:space:]]'),
  constraint app_collab_groups_dept_name_check check (
    dept_name is null or (char_length(dept_name) between 1 and 60 and dept_name !~ '[[:cntrl:]]' and dept_name ~ '[^[:space:]]')),
  constraint app_collab_groups_name_key_check check (char_length(name_key) between 1 and 130)
);
create index app_collab_groups_name_key_idx on public.app_collab_groups (kind, name_key);

create table public.app_collab_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.app_collab_groups(id) on delete cascade,
  user_id uuid not null,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  member_role text not null,
  display_name text not null,
  title text,
  joined_at timestamptz not null default now(),
  constraint app_collab_members_group_user_key unique (group_id, user_id),
  constraint app_collab_members_role_check check (member_role in ('admin', 'member')),
  constraint app_collab_members_display_check check (
    char_length(display_name) between 1 and 60 and display_name !~ '[[:cntrl:]]'
    and (title is null or (char_length(title) between 1 and 60 and title !~ '[[:cntrl:]]')))
);
create unique index app_collab_members_one_admin_idx on public.app_collab_members (group_id) where member_role = 'admin';
create index app_collab_members_user_idx on public.app_collab_members (user_id);
create index app_collab_members_workspace_idx on public.app_collab_members (workspace_id);

create table public.app_collab_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.app_collab_groups(id) on delete cascade,
  token_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  uses_left integer not null default 1,
  revoked_at timestamptz,
  constraint app_collab_invites_token_hash_key unique (token_hash),
  constraint app_collab_invites_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint app_collab_invites_uses_check check (uses_left between 0 and 1)
);
create index app_collab_invites_group_idx on public.app_collab_invites (group_id);

create table public.app_collab_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.app_collab_groups(id) on delete cascade,
  source_group_id uuid references public.app_collab_groups(id) on delete set null,
  requester_user_id uuid not null,
  requester_display_name text not null,
  requester_title text,
  status text not null default 'pending',
  decided_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_collab_join_requests_status_check check (status in ('pending', 'accepted', 'declined', 'expired')),
  constraint app_collab_join_requests_display_check check (
    char_length(requester_display_name) between 1 and 60 and requester_display_name !~ '[[:cntrl:]]'
    and (requester_title is null or (char_length(requester_title) between 1 and 60 and requester_title !~ '[[:cntrl:]]')))
);
create index app_collab_join_requests_group_idx on public.app_collab_join_requests (group_id, status);
create index app_collab_join_requests_source_idx on public.app_collab_join_requests (source_group_id);
create index app_collab_join_requests_requester_idx on public.app_collab_join_requests (requester_user_id);

create table public.app_collab_join_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index app_collab_join_attempts_user_idx on public.app_collab_join_attempts (user_id, created_at);

create table public.app_collab_member_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.app_collab_groups(id) on delete cascade,
  user_id uuid not null,
  event text not null,
  at timestamptz not null default now(),
  constraint app_collab_member_log_event_check check (event in ('join', 'leave', 'removed', 'admin_moved'))
);
create index app_collab_member_log_group_idx on public.app_collab_member_log (group_id);

alter table public.app_collab_groups enable row level security;
alter table public.app_collab_members enable row level security;
alter table public.app_collab_invites enable row level security;
alter table public.app_collab_join_requests enable row level security;
alter table public.app_collab_join_attempts enable row level security;
alter table public.app_collab_member_log enable row level security;
revoke all on table public.app_collab_groups from public, anon, authenticated, service_role;
revoke all on table public.app_collab_members from public, anon, authenticated, service_role;
revoke all on table public.app_collab_invites from public, anon, authenticated, service_role;
revoke all on table public.app_collab_join_requests from public, anon, authenticated, service_role;
revoke all on table public.app_collab_join_attempts from public, anon, authenticated, service_role;
revoke all on table public.app_collab_member_log from public, anon, authenticated, service_role;

-- private 도우미(실행권 아무에게도 없음 — DEFINER 공개 함수 안에서만 쓰임) ------------------------------------

-- 이름 글 정리: 앞뒤 공백 제거·연속 공백 하나로. 1~60자 한 줄 아니면 null.
create function private.app_collab_clean_name(p_text text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when c is not null and char_length(c) between 1 and 60 and c !~ '[[:cntrl:]]' then c end
    from (select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g'), '') as c) x
$$;
revoke all on function private.app_collab_clean_name(text) from public, anon, authenticated, service_role;

-- 부른 사람의 작업공간(owner 행, 읽기만). 없으면 null.
create function private.app_collab_my_workspace()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select m.workspace_id from public.app_workspace_members m
   where m.user_id = (select auth.uid()) and m.role = 'owner' and m.workspace_id is not null
   order by m.workspace_id limit 1
$$;
revoke all on function private.app_collab_my_workspace() from public, anon, authenticated, service_role;

-- 부른 사람의 그 묶음 역할('admin'·'member'), 멤버 아니면 null.
create function private.app_collab_my_role(p_group uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select m.member_role from public.app_collab_members m
   where m.group_id = p_group and m.user_id = (select auth.uid())
$$;
revoke all on function private.app_collab_my_role(uuid) from public, anon, authenticated, service_role;

-- 공개 RPC ----------------------------------------------------------------------------------------

-- 묶음 만들기. 같은 이름 묶음이 있으면 새 묶음은 만들고 그 묶음 관리자에게 들어오기 요청을 남긴다. 돌려주는 말은 언제나 같다.
create function public.app_collab_group_create(p_kind text, p_union_name text, p_dept_name text, p_agree boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_name text;
  v_title text;
  v_union text;
  v_dept text;
  v_key text;
  v_group uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  v_ws := private.app_collab_my_workspace();
  if v_ws is null then
    raise exception using errcode = '42501', message = 'COLLAB_WORKSPACE_REQUIRED';
  end if;
  if p_agree is distinct from true then
    raise exception using errcode = '22023', message = 'COLLAB_CONSENT_REQUIRED';
  end if;
  select private.app_collab_clean_name(p.display_name), private.app_collab_clean_name(p.job_title)
    into v_name, v_title
    from public.app_profiles p where p.user_id = v_uid;
  if v_name is null then
    raise exception using errcode = '22023', message = 'COLLAB_PROFILE_NAME_REQUIRED';
  end if;
  v_union := private.app_collab_clean_name(p_union_name);
  v_dept := private.app_collab_clean_name(p_dept_name);
  if p_kind is null or p_kind not in ('dept', 'union') or v_union is null
     or (p_kind = 'dept' and v_dept is null)
     or (p_kind = 'union' and nullif(pg_catalog.btrim(coalesce(p_dept_name, '')), '') is not null) then
    raise exception using errcode = '22023', message = 'COLLAB_NAME_INVALID';
  end if;
  if p_kind = 'union' then
    v_dept := null;
  end if;

  -- 같은 사람의 동시 만들기를 줄 세운다(하루 횟수 판정이 겹치지 않게).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_collab_group_create:' || v_uid::text, 0));
  if (select count(*) from public.app_collab_join_attempts a
       where a.user_id = v_uid and a.created_at > now() - interval '1 day') >= 3 then
    return 'COLLAB_GROUP_CREATED';
  end if;
  if (select count(*) from public.app_collab_members m where m.user_id = v_uid) >= 10 then
    raise exception using errcode = 'P0001', message = 'COLLAB_LIMIT';
  end if;

  v_key := pg_catalog.lower(pg_catalog.regexp_replace(v_union, '[[:space:]]', '', 'g'));
  if p_kind = 'dept' then
    v_key := v_key || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_dept, '[[:space:]]', '', 'g'));
  end if;

  insert into public.app_collab_join_attempts (user_id) values (v_uid);
  insert into public.app_collab_groups (kind, union_name, dept_name, name_key, created_by)
    values (p_kind, v_union, v_dept, v_key, v_uid)
    returning id into v_group;
  insert into public.app_collab_members (group_id, user_id, workspace_id, member_role, display_name, title)
    values (v_group, v_uid, v_ws, 'admin', v_name, v_title);
  insert into public.app_collab_member_log (group_id, user_id, event) values (v_group, v_uid, 'join');

  insert into public.app_collab_join_requests (group_id, source_group_id, requester_user_id, requester_display_name, requester_title)
  select g.id, v_group, v_uid, v_name, v_title
    from public.app_collab_groups g
   where g.kind = p_kind and g.name_key = v_key and g.id <> v_group
     and not exists (select 1 from public.app_collab_members m where m.group_id = g.id and m.user_id = v_uid)
   order by g.created_at, g.id
   limit 5;

  return 'COLLAB_GROUP_CREATED';
end
$$;
revoke all on function public.app_collab_group_create(text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_group_create(text, text, text, boolean) to authenticated;

-- 초대 링크 만들기(관리자만, 결정 ⑦). 원문 글자는 여기서 한 번만 돌려준다.
create function public.app_collab_invite_create(p_group uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  if p_group is null or private.app_collab_my_role(p_group) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';
  end if;
  if (select count(*) from public.app_collab_invites i
       where i.group_id = p_group and i.revoked_at is null and i.uses_left > 0 and i.expires_at > now()) >= 20 then
    raise exception using errcode = 'P0001', message = 'COLLAB_LIMIT';
  end if;
  v_token := pg_catalog.replace(gen_random_uuid()::text, '-', '') || pg_catalog.replace(gen_random_uuid()::text, '-', '');
  insert into public.app_collab_invites (group_id, token_hash, created_by, expires_at)
    values (p_group, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex'), v_uid, v_expires);
  return pg_catalog.jsonb_build_object('token', v_token, 'expires_at', v_expires);
end
$$;
revoke all on function public.app_collab_invite_create(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_invite_create(uuid) to authenticated;

-- 살아 있는 초대 링크 모두 끄기(관리자만).
create function public.app_collab_invite_revoke_all(p_group uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  if p_group is null or private.app_collab_my_role(p_group) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';
  end if;
  update public.app_collab_invites i set revoked_at = now()
   where i.group_id = p_group and i.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.app_collab_invite_revoke_all(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_invite_revoke_all(uuid) to authenticated;

-- 초대 링크 미리 보기(들어가기 전 화면): 쓸 수 있는 링크일 때만 묶음 이름·관리자 이름·직책·멤버 수. 아니면 같은 거절 하나.
create function public.app_collab_invite_peek(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'COLLAB_INVITE_UNUSABLE';
  end if;
  select i.group_id into v_group
    from public.app_collab_invites i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
     and i.revoked_at is null and i.uses_left > 0 and i.expires_at > now();
  if v_group is null then
    raise exception using errcode = 'P0001', message = 'COLLAB_INVITE_UNUSABLE';
  end if;
  select pg_catalog.jsonb_build_object(
           'kind', g.kind, 'union_name', g.union_name, 'dept_name', g.dept_name,
           'admin_name', a.display_name, 'admin_title', a.title,
           'member_count', (select count(*) from public.app_collab_members m where m.group_id = g.id),
           'already_member', exists (select 1 from public.app_collab_members m where m.group_id = g.id and m.user_id = v_uid))
    into v_result
    from public.app_collab_groups g
    left join public.app_collab_members a on a.group_id = g.id and a.member_role = 'admin'
   where g.id = v_group;
  return v_result;
end
$$;
revoke all on function public.app_collab_invite_peek(text) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_invite_peek(text) to authenticated;

-- 초대 링크로 들어가기(동의 필수). 이미 멤버면 링크를 쓰지 않고 그대로.
create function public.app_collab_invite_accept(p_token text, p_agree boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_name text;
  v_title text;
  v_invite uuid;
  v_group uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  v_ws := private.app_collab_my_workspace();
  if v_ws is null then
    raise exception using errcode = '42501', message = 'COLLAB_WORKSPACE_REQUIRED';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'COLLAB_INVITE_UNUSABLE';
  end if;
  select i.id, i.group_id into v_invite, v_group
    from public.app_collab_invites i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
     and i.revoked_at is null and i.uses_left > 0 and i.expires_at > now()
   for update;
  if v_invite is null then
    raise exception using errcode = 'P0001', message = 'COLLAB_INVITE_UNUSABLE';
  end if;
  if exists (select 1 from public.app_collab_members m where m.group_id = v_group and m.user_id = v_uid) then
    return v_group;
  end if;
  if p_agree is distinct from true then
    raise exception using errcode = '22023', message = 'COLLAB_CONSENT_REQUIRED';
  end if;
  select private.app_collab_clean_name(p.display_name), private.app_collab_clean_name(p.job_title)
    into v_name, v_title
    from public.app_profiles p where p.user_id = v_uid;
  if v_name is null then
    raise exception using errcode = '22023', message = 'COLLAB_PROFILE_NAME_REQUIRED';
  end if;
  if (select count(*) from public.app_collab_members m where m.user_id = v_uid) >= 10
     or (select count(*) from public.app_collab_members m where m.group_id = v_group) >= 100 then
    raise exception using errcode = 'P0001', message = 'COLLAB_LIMIT';
  end if;
  update public.app_collab_invites i set uses_left = i.uses_left - 1 where i.id = v_invite;
  insert into public.app_collab_members (group_id, user_id, workspace_id, member_role, display_name, title)
    values (v_group, v_uid, v_ws, 'member', v_name, v_title);
  insert into public.app_collab_member_log (group_id, user_id, event) values (v_group, v_uid, 'join');
  update public.app_collab_join_requests r set status = 'expired', decided_at = now()
   where r.group_id = v_group and r.requester_user_id = v_uid and r.status = 'pending';
  return v_group;
end
$$;
revoke all on function public.app_collab_invite_accept(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_invite_accept(text, boolean) to authenticated;

-- 같은 이름 들어오기 요청 수락·거절(관리자만, 결정 ⑥). 수락하면 요청자가 이 묶음에 들어오고,
-- 요청자가 만든 새 묶음에 요청자 혼자였으면 그 새 묶음을 지운다(합침). 같은 만들기에서 간 다른 요청은 expired.
-- 요청이 없거나 내가 관리자가 아니면 같은 거절(요청 존재를 알리지 않음). 이미 정해졌거나 14일 지난 요청은 'gone'.
create function public.app_collab_request_decide(p_request uuid, p_accept boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_req public.app_collab_join_requests%rowtype;
  v_ws uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  if p_request is null or p_accept is null then
    raise exception using errcode = '22023', message = 'COLLAB_INPUT_INVALID';
  end if;
  select r.* into v_req from public.app_collab_join_requests r where r.id = p_request for update;
  if v_req.id is null or private.app_collab_my_role(v_req.group_id) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';
  end if;
  if v_req.status <> 'pending' then
    return 'gone';
  end if;
  if v_req.created_at <= now() - interval '14 days' then
    update public.app_collab_join_requests r set status = 'expired', decided_at = now() where r.id = v_req.id;
    return 'gone';
  end if;
  if not p_accept then
    update public.app_collab_join_requests r set status = 'declined', decided_by = v_uid, decided_at = now()
     where r.id = v_req.id;
    return 'declined';
  end if;

  select m.workspace_id into v_ws from public.app_workspace_members m
   where m.user_id = v_req.requester_user_id and m.role = 'owner' and m.workspace_id is not null
   order by m.workspace_id limit 1;
  if v_ws is null then
    update public.app_collab_join_requests r set status = 'expired', decided_at = now() where r.id = v_req.id;
    return 'gone';
  end if;
  if not exists (select 1 from public.app_collab_members m
                  where m.group_id = v_req.group_id and m.user_id = v_req.requester_user_id) then
    if (select count(*) from public.app_collab_members m where m.group_id = v_req.group_id) >= 100 then
      raise exception using errcode = 'P0001', message = 'COLLAB_LIMIT';
    end if;
    insert into public.app_collab_members (group_id, user_id, workspace_id, member_role, display_name, title)
      values (v_req.group_id, v_req.requester_user_id, v_ws, 'member', v_req.requester_display_name, v_req.requester_title);
    insert into public.app_collab_member_log (group_id, user_id, event)
      values (v_req.group_id, v_req.requester_user_id, 'join');
  end if;
  update public.app_collab_join_requests r set status = 'accepted', decided_by = v_uid, decided_at = now()
   where r.id = v_req.id;
  if v_req.source_group_id is not null then
    update public.app_collab_join_requests r set status = 'expired', decided_at = now()
     where r.source_group_id = v_req.source_group_id and r.requester_user_id = v_req.requester_user_id
       and r.status = 'pending' and r.id <> v_req.id;
    delete from public.app_collab_groups g
     where g.id = v_req.source_group_id
       and (select count(*) from public.app_collab_members m where m.group_id = g.id) = 1
       and exists (select 1 from public.app_collab_members m
                    where m.group_id = g.id and m.user_id = v_req.requester_user_id);
  end if;
  return 'accepted';
end
$$;
revoke all on function public.app_collab_request_decide(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_request_decide(uuid, boolean) to authenticated;

-- 내 묶음과 그 멤버(이름·직책·역할)만. 관리자인 묶음에는 들어오기 요청(14일 안, 대기)과 살아 있는 링크 수를 더한다.
-- 다른 묶음 정보·user_id·workspace_id는 돌려주지 않는다(멤버는 멤버 행 id로 가리킨다).
create function public.app_collab_my_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', g.id, 'kind', g.kind, 'union_name', g.union_name, 'dept_name', g.dept_name,
             'my_role', me.member_role, 'joined_at', me.joined_at,
             'members', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'id', m.id, 'name', m.display_name, 'title', m.title, 'role', m.member_role,
                                 'me', m.user_id = v_uid) order by (m.member_role = 'admin') desc, m.joined_at, m.id), '[]'::jsonb)
                           from public.app_collab_members m where m.group_id = g.id),
             'requests', case when me.member_role = 'admin' then
                           (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                     'id', r.id, 'name', r.requester_display_name, 'title', r.requester_title,
                                     'created_at', r.created_at) order by r.created_at, r.id), '[]'::jsonb)
                              from public.app_collab_join_requests r
                             where r.group_id = g.id and r.status = 'pending' and r.created_at > now() - interval '14 days')
                         else '[]'::jsonb end,
             'invites_live', case when me.member_role = 'admin' then
                               (select count(*) from public.app_collab_invites i
                                 where i.group_id = g.id and i.revoked_at is null and i.uses_left > 0 and i.expires_at > now())
                             end)
           order by (g.kind = 'dept') desc, me.joined_at, g.id)
      from public.app_collab_members me
      join public.app_collab_groups g on g.id = me.group_id
     where me.user_id = v_uid), '[]'::jsonb);
end
$$;
revoke all on function public.app_collab_my_groups() from public, anon, authenticated, service_role;
grant execute on function public.app_collab_my_groups() to authenticated;

-- 묶음 나가기. 관리자는 다른 멤버가 있으면 먼저 넘긴다. 마지막 한 명이 나가면 묶음을 지운다.
create function public.app_collab_leave(p_group uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  if p_group is null then
    raise exception using errcode = '42501', message = 'COLLAB_MEMBER_REQUIRED';
  end if;
  perform 1 from public.app_collab_groups g where g.id = p_group for update;
  v_role := private.app_collab_my_role(p_group);
  if v_role is null then
    raise exception using errcode = '42501', message = 'COLLAB_MEMBER_REQUIRED';
  end if;
  if (select count(*) from public.app_collab_members m where m.group_id = p_group) = 1 then
    delete from public.app_collab_groups g where g.id = p_group;
    return 'group_deleted';
  end if;
  if v_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'COLLAB_ADMIN_MUST_MOVE';
  end if;
  delete from public.app_collab_members m where m.group_id = p_group and m.user_id = v_uid;
  insert into public.app_collab_member_log (group_id, user_id, event) values (p_group, v_uid, 'leave');
  return 'left';
end
$$;
revoke all on function public.app_collab_leave(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_leave(uuid) to authenticated;

-- 관리자가 멤버 내보내기(자기 자신은 안 됨 — 나가기 사용).
create function public.app_collab_member_remove(p_member uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
  v_user uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  select m.group_id, m.user_id into v_group, v_user from public.app_collab_members m where m.id = p_member for update;
  if v_group is null or private.app_collab_my_role(v_group) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';
  end if;
  if v_user = v_uid then
    raise exception using errcode = '22023', message = 'COLLAB_SELF_NOT_ALLOWED';
  end if;
  delete from public.app_collab_members m where m.id = p_member;
  insert into public.app_collab_member_log (group_id, user_id, event) values (v_group, v_user, 'removed');
  return 'removed';
end
$$;
revoke all on function public.app_collab_member_remove(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_member_remove(uuid) to authenticated;

-- 관리자 넘기기(받는 사람은 같은 묶음 현재 멤버). 관리자는 묶음마다 한 명.
create function public.app_collab_admin_move(p_member uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
  v_user uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';
  end if;
  select m.group_id, m.user_id into v_group, v_user from public.app_collab_members m where m.id = p_member for update;
  if v_group is null or private.app_collab_my_role(v_group) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';
  end if;
  if v_user = v_uid then
    raise exception using errcode = '22023', message = 'COLLAB_SELF_NOT_ALLOWED';
  end if;
  update public.app_collab_members m set member_role = 'member' where m.group_id = v_group and m.user_id = v_uid;
  update public.app_collab_members m set member_role = 'admin' where m.id = p_member;
  insert into public.app_collab_member_log (group_id, user_id, event) values (v_group, v_user, 'admin_moved');
  return 'moved';
end
$$;
revoke all on function public.app_collab_admin_move(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_collab_admin_move(uuid) to authenticated;

-- 사후 확인: 새 표 6개 RLS 켬·정책 0·API 역할 권한 0, 함수 DEFINER(공개)·invoker(도우미)·빈 search_path·실행권 경계. 다르면 전체 취소.
do $$
declare
  t regclass;
begin
  foreach t in array array['public.app_collab_groups', 'public.app_collab_members', 'public.app_collab_invites',
                           'public.app_collab_join_requests', 'public.app_collab_join_attempts',
                           'public.app_collab_member_log']::regclass[] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or (select count(*) from pg_policy where polrelid = t) <> 0
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
       or has_any_column_privilege('service_role', t, 'select,insert,update,references')
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|authenticated|service_role)?=')
       or exists (select 1 from pg_trigger where tgrelid = t and not tgisinternal) then
      raise exception 'COLLAB_GROUPS_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'app\_collab\_%'
         and p.prosecdef and p.proconfig = array['search_path=""']
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('service_role', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) <> 10
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'app\_collab\_%') <> 10
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname like 'app\_collab\_%'
            and not p.prosecdef and p.proconfig = array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')) <> 3
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname like 'app\_collab\_%') <> 3
     or (select count(*) from public.app_collab_groups) <> 0 then
    raise exception 'COLLAB_GROUPS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261118100000', 'collab_groups', array['COLLAB stage 1 groups: 6 new tables app_collab_groups, app_collab_members, app_collab_invites, app_collab_join_requests, app_collab_join_attempts, app_collab_member_log (RLS on, no policies, no anon/authenticated/service_role privileges); 10 public SECURITY DEFINER RPCs with empty search_path, auth.uid() required, authenticated execute only (group_create, invite_create, invite_revoke_all, invite_peek, invite_accept, request_decide, my_groups, leave, member_remove, admin_move); 3 private invoker helpers with no execute grants; no existing table, policy, grant or row changed']);
commit;
