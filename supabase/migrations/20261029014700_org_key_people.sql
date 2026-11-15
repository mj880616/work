begin;
-- ORG-주요인물 1/2 DB(요청함 2026-10-29 01:26 항목 3·4·6, 01:29 사용자 결정): 담당조직마다 '주요 인물'을 지정해 두고,
-- 그 사람의 통화·텔레그램·회의·약속을 조직 상세 [주요 인물] 탭에 모은다. 사람 화면·사람 목록은 만들지 않는다.
-- 바꾸는 것: 새 표 2개와 그 표의 트리거 함수 1개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
--  1) app_org_key_people: 조직 하나의 주요 인물(이름 1~40자) + 찾을 이름(통화·텔레그램에 그 사람이 찍히는 이름, 2~40자, 20개까지).
--     직책·연락처 칸은 두지 않는다(결정). 한 사람을 여러 조직에 지정할 수 있다(조직마다 따로 한 행, 같은 조직에 같은 이름은 한 번).
--  2) app_org_key_people_briefs: 조직마다 '요즘' AI 한 문장(하루 한 번 갱신, 조직당 1행). 서버 AI(ai-assist)가 내 로그인으로 쓴다.
--  3) 트리거: 조직은 같은 작업공간이어야 한다. 찾을 이름은 앞뒤 공백·제어문자·빈 이름·중복 금지.
-- 권한: owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음. workspace_id·organization_id는 고칠 수 없다.
-- 짝: docs/20261029014700_org_key_people.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029014700')
     or to_regclass('public.app_org_key_people') is not null
     or to_regclass('public.app_org_key_people_briefs') is not null
     or to_regprocedure('private.app_org_key_people_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'ORG_KEY_PEOPLE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 주요 인물. 조직을 지우면 함께 지움, 작업공간을 지우면 함께 지움.
create table public.app_org_key_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  name text not null,
  match_names text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_org_key_people_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_org_key_people_match_names_check check (
    cardinality(match_names) <= 20 and array_position(match_names, null) is null),
  constraint app_org_key_people_org_name_key unique (organization_id, name)
);
create index app_org_key_people_scope_idx on public.app_org_key_people(workspace_id, organization_id, sort_order);

-- '요즘' 한 문장. 조직당 1행(그날 처음 열 때 서버 AI가 새로 씀). people_ids는 그 문장을 만들 때의 주요 인물(화면이 바뀐 줄 앎).
create table public.app_org_key_people_briefs (
  organization_id uuid primary key references public.app_suborganizations(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  brief text not null,
  detail text,
  people_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint app_org_key_people_briefs_brief_check check (
    char_length(brief) between 1 and 300 and brief !~ '[[:cntrl:]]'),
  constraint app_org_key_people_briefs_detail_check check (
    detail is null or char_length(detail) between 1 and 2000),
  constraint app_org_key_people_briefs_people_check check (
    cardinality(people_ids) <= 40 and array_position(people_ids, null) is null)
);
create index app_org_key_people_briefs_workspace_idx on public.app_org_key_people_briefs(workspace_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_org_key_people enable row level security;
alter table public.app_org_key_people_briefs enable row level security;
revoke all on table public.app_org_key_people from public, anon, authenticated, service_role;
revoke all on table public.app_org_key_people_briefs from public, anon, authenticated, service_role;
grant select, delete on table public.app_org_key_people to authenticated;
grant insert (workspace_id, organization_id, name, match_names, sort_order) on table public.app_org_key_people to authenticated;
grant update (name, match_names, sort_order, updated_at) on table public.app_org_key_people to authenticated;
grant select, delete on table public.app_org_key_people_briefs to authenticated;
grant insert (organization_id, workspace_id, day, brief, detail, people_ids) on table public.app_org_key_people_briefs to authenticated;
grant update (day, brief, detail, people_ids, updated_at) on table public.app_org_key_people_briefs to authenticated;

create policy org_key_people_owner_all on public.app_org_key_people for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

create policy org_key_people_briefs_owner_all on public.app_org_key_people_briefs for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 조직은 같은 작업공간이어야 하고, 찾을 이름은 깨끗해야 한다(두 표가 함께 쓴다).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'ORG_KEY_PEOPLE_SCOPE:' / 'ORG_KEY_PEOPLE_MATCH:'.
create function private.app_org_key_people_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_name text;
  v_seen text[] := '{}';
begin
  if not exists (
    select 1 from public.app_suborganizations o
    where o.id = new.organization_id and o.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = '23514',
      message = 'ORG_KEY_PEOPLE_SCOPE: organization must be in the same workspace';
  end if;
  if tg_table_name = 'app_org_key_people' then
    foreach v_name in array new.match_names loop
      if char_length(v_name) not between 2 and 40 or v_name <> btrim(v_name) or v_name ~ '[[:cntrl:]]'
         or v_name = any(v_seen) then
        raise exception using errcode = '23514',
          message = 'ORG_KEY_PEOPLE_MATCH: match names must be 2-40 trimmed characters without duplicates';
      end if;
      v_seen := v_seen || v_name;
    end loop;
  end if;
  return new;
end
$guard$;
revoke all on function private.app_org_key_people_guard() from public, anon, authenticated, service_role;

create trigger app_org_key_people_guard
before insert or update on public.app_org_key_people
for each row execute function private.app_org_key_people_guard();

create trigger app_org_key_people_briefs_guard
before insert or update on public.app_org_key_people_briefs
for each row execute function private.app_org_key_people_guard();

-- 사후 확인: RLS 켜짐, 표마다 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음,
-- workspace_id·organization_id 고칠 수 없음, 트리거 표마다 1개. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_org_key_people'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_org_key_people_briefs'::regclass)
     or exists (select 1 from pg_class where oid in ('public.app_org_key_people'::regclass, 'public.app_org_key_people_briefs'::regclass)
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_org_key_people'::regclass, 'public.app_org_key_people_briefs'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_org_key_people', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_org_key_people_briefs', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_org_key_people', 'truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_org_key_people_briefs', 'truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_org_key_people', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_org_key_people', 'organization_id', 'update')
     or has_column_privilege('authenticated', 'public.app_org_key_people', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_org_key_people_briefs', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_org_key_people_briefs', 'organization_id', 'update')
     or not has_column_privilege('authenticated', 'public.app_org_key_people', 'match_names', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_org_key_people'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_org_key_people_briefs'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_org_key_people'::regclass, 'public.app_org_key_people_briefs'::regclass)
         and polroles = array['authenticated'::regrole]::oid[]) <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.app_org_key_people'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_org_key_people_briefs'::regclass and not tgisinternal) <> 1 then
    raise exception 'ORG_KEY_PEOPLE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029014700', 'org_key_people', array['ORG-주요인물: app_org_key_people + app_org_key_people_briefs (owner RLS, same-workspace organization guard, clean match names)']);
commit;
