begin;
-- DESK-현황표 2/3 DB(요청함 2026-10-30 13:38, 명진 결정 "모두반영"): 담당조직 상세 [현황 표] 소탭의 '일 | 주요 일정·현황' 줄을 서버에 둔다.
-- 같은 줄이 주간보고 '3. 2) 투쟁 사업장 현황'의 그 조직 칸에 들어간다(한 곳만 고치면 두 곳 같음).
-- 바꾸는 것: 새 표 1개와 그 표의 트리거 함수 1개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
--  app_org_status_rows: 조직 하나의 현황 줄(날짜 + 글 1~200자, 순서, 출처 ai|user, 근거 기록 번호 10개까지).
--   source='ai'는 [기록에서 다시 채우기 (AI)]가 뽑은 그대로인 줄, 'user'는 사람이 넣거나 고친 줄(다시 채우기가 덮어쓰지 않음).
--   근거(evidence)는 그 줄을 뽑은 조직 기록·연결 기록 번호다(원문은 옮기지 않음).
--  트리거: 조직은 같은 작업공간이어야 하고, 조직마다 줄은 30개까지.
-- 권한: owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음. workspace_id·organization_id는 고칠 수 없다.
-- 짝: docs/20261030234000_org_status_rows.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030234000')
     or to_regclass('public.app_org_status_rows') is not null
     or to_regprocedure('private.app_org_status_rows_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'ORG_STATUS_ROWS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 현황 줄. 조직을 지우면 함께 지움, 작업공간을 지우면 함께 지움.
create table public.app_org_status_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  day date not null,
  body text not null,
  sort_order integer not null default 0,
  source text not null default 'user',
  evidence uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_org_status_rows_body_check check (
    char_length(body) between 1 and 200 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  constraint app_org_status_rows_sort_check check (sort_order between 0 and 1000),
  constraint app_org_status_rows_source_check check (source in ('ai', 'user')),
  constraint app_org_status_rows_evidence_check check (
    cardinality(evidence) <= 10 and array_position(evidence, null) is null)
);
create index app_org_status_rows_scope_idx on public.app_org_status_rows(workspace_id, organization_id, sort_order);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_org_status_rows enable row level security;
revoke all on table public.app_org_status_rows from public, anon, authenticated, service_role;
grant select, delete on table public.app_org_status_rows to authenticated;
grant insert (workspace_id, organization_id, day, body, sort_order, source, evidence) on table public.app_org_status_rows to authenticated;
grant update (day, body, sort_order, source, evidence, updated_at) on table public.app_org_status_rows to authenticated;

create policy org_status_rows_owner_all on public.app_org_status_rows for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 조직은 같은 작업공간이어야 하고, 조직마다 줄은 30개까지.
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'ORG_STATUS_ROWS_SCOPE:' / 'ORG_STATUS_ROWS_LIMIT:'.
create function private.app_org_status_rows_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if not exists (
    select 1 from public.app_suborganizations o
    where o.id = new.organization_id and o.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = '23514',
      message = 'ORG_STATUS_ROWS_SCOPE: organization must be in the same workspace';
  end if;
  if tg_op = 'INSERT' and (
    select count(*) from public.app_org_status_rows r where r.organization_id = new.organization_id
  ) >= 30 then
    raise exception using errcode = '23514',
      message = 'ORG_STATUS_ROWS_LIMIT: at most 30 rows per organization';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_org_status_rows_guard() from public, anon, authenticated, service_role;

create trigger app_org_status_rows_guard
before insert or update on public.app_org_status_rows
for each row execute function private.app_org_status_rows_guard();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음,
-- workspace_id·organization_id 고칠 수 없음, 트리거 1개. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_org_status_rows'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_org_status_rows'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_org_status_rows'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_org_status_rows', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_org_status_rows', 'truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_org_status_rows', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_org_status_rows', 'organization_id', 'update')
     or has_column_privilege('authenticated', 'public.app_org_status_rows', 'id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_org_status_rows', 'body', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_org_status_rows'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_org_status_rows'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_org_status_rows'::regclass and not tgisinternal) <> 1 then
    raise exception 'ORG_STATUS_ROWS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030234000', 'org_status_rows', array['DESK-현황표: app_org_status_rows (owner RLS, same-workspace organization guard, 30 rows per organization)']);
commit;
