begin;
-- WEEKLY-메뉴짝짓기 P1(요청함 11/04 16:48·16:53, 명진 결정 16:50 B·16:58·17:34): 주간보고 '조직보고' 칸의 저장 자리 하나 — 주 × 조직 × 줄.
-- 설계: docs/design/weekly-menu-pairing.md 5절. 담당조직 '이번 주 조직보고'와 홈 [주간 정리]가 같은 줄을 읽고 쓴다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 바꾸는 것: 새 표 1개와 그 표의 트리거 함수 1개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다(기존 현황 표 줄도 옮기지 않음).
--  app_weekly_org_lines: 그 주(월요일) 그 조직의 줄 하나 = 행 하나(날짜·끝나는 날 선택, 글 1~200자 한 줄, 순서).
--   state: suggested(제안, 흐리게) | in(주간보고에 넣음) | dropped(뺌 — 지우지 않고 남겨 같은 기록으로 다시 제안하지 않음).
--   origin: user(수기) | plain(AI 없이 정돈) | ai(AI가 줄임) | last_week(지난주 가져오기). edited: 사람이 글을 고침(원래 기록이 바뀌어도 덮지 않음).
--   source_*_ids: 그 줄의 출처 기록 번호(조직 기록·조직에 이어진 업데이트·현황 표 줄, 각각 10개까지). 원문은 옮기지 않는다.
--  트리거: 조직·출처 기록은 같은 작업공간이어야 하고(사용자 권한 그대로 읽음), (주 × 조직) 줄은 40개까지, updated_at은 서버 시각.
--   updated_at은 동시 고침 판정(PATCH ...&updated_at=eq.<읽은 값>)에 쓴다.
-- 권한: owner만(private.app_is_workspace_owner). 지우기 권한 없음(빼기 = state 'dropped'). anon·PUBLIC·service_role 권한 없음.
--   workspace_id·organization_id·week_start·origin은 만든 뒤 고칠 수 없다. SECURITY DEFINER 없음.
-- 짝: docs/20261104211500_weekly_org_lines.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104211500')
     or to_regclass('public.app_weekly_org_lines') is not null
     or to_regprocedure('private.app_weekly_org_lines_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261030234000' and name = 'org_status_rows') <> 1
     or (select count(*) from pg_attribute where not attisdropped and attnum > 0 and atttypid = 'uuid'::regtype and (
           (attrelid = to_regclass('public.app_suborganizations') and attname in ('id', 'workspace_id'))
        or (attrelid = to_regclass('public.app_suborganization_updates') and attname in ('id', 'organization_id'))
        or (attrelid = to_regclass('public.app_notes') and attname in ('id', 'workspace_id'))
        or (attrelid = to_regclass('public.app_org_status_rows') and attname in ('id', 'workspace_id')))) <> 8
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'WEEKLY_ORG_LINES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 주별 조직보고 줄. 조직을 지우면 함께 지움, 작업공간을 지우면 함께 지움.
create table public.app_weekly_org_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  day date,
  end_day date,
  body text not null,
  sort_order integer not null default 0,
  state text not null default 'in',
  origin text not null default 'user',
  edited boolean not null default false,
  source_update_ids uuid[] not null default '{}',
  source_note_ids uuid[] not null default '{}',
  source_status_ids uuid[] not null default '{}',
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_weekly_org_lines_week_check check (extract(isodow from week_start) = 1),
  constraint app_weekly_org_lines_end_check check (end_day is null or (day is not null and end_day >= day)),
  constraint app_weekly_org_lines_body_check check (
    char_length(body) between 1 and 200 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  constraint app_weekly_org_lines_sort_check check (sort_order between 0 and 1000),
  constraint app_weekly_org_lines_state_check check (state in ('suggested', 'in', 'dropped')),
  constraint app_weekly_org_lines_origin_check check (origin in ('user', 'plain', 'ai', 'last_week')),
  constraint app_weekly_org_lines_sources_check check (
    cardinality(source_update_ids) <= 10 and array_position(source_update_ids, null) is null
    and cardinality(source_note_ids) <= 10 and array_position(source_note_ids, null) is null
    and cardinality(source_status_ids) <= 10 and array_position(source_status_ids, null) is null),
  constraint app_weekly_org_lines_hash_check check (source_hash is null or source_hash ~ '^[0-9a-f]{16,64}$')
);
create index app_weekly_org_lines_scope_idx on public.app_weekly_org_lines(workspace_id, week_start, organization_id, sort_order);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기, 넣기·고치기는 필요한 칸만. 지우기 없음.
alter table public.app_weekly_org_lines enable row level security;
revoke all on table public.app_weekly_org_lines from public, anon, authenticated, service_role;
grant select on table public.app_weekly_org_lines to authenticated;
grant insert (workspace_id, week_start, organization_id, day, end_day, body, sort_order, state, origin, edited,
  source_update_ids, source_note_ids, source_status_ids, source_hash) on table public.app_weekly_org_lines to authenticated;
grant update (day, end_day, body, sort_order, state, edited,
  source_update_ids, source_note_ids, source_status_ids, source_hash) on table public.app_weekly_org_lines to authenticated;

create policy weekly_org_lines_owner_all on public.app_weekly_org_lines for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 조직·출처 기록은 같은 작업공간이어야 하고(호출한 사용자의 권한 그대로 읽는다 — 볼 수 없는 기록이면 거절),
-- (주 × 조직) 줄은 제안·뺀 줄 포함 40개까지, updated_at은 매 쓰기마다 서버 시각.
-- 출처 검사는 넣을 때와 출처 번호를 바꿀 때만(원래 기록이 나중에 지워져도 글 고치기는 막지 않음).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'WEEKLY_ORG_LINES_SCOPE:' / 'WEEKLY_ORG_LINES_SOURCE:' / 'WEEKLY_ORG_LINES_LIMIT:'.
create function private.app_weekly_org_lines_guard()
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
      message = 'WEEKLY_ORG_LINES_SCOPE: organization must be in the same workspace';
  end if;
  if (tg_op = 'INSERT' or new.source_update_ids is distinct from old.source_update_ids)
     and (select count(distinct u.id) from public.app_suborganization_updates u
          join public.app_suborganizations o on o.id = u.organization_id
          where u.id = any(new.source_update_ids) and o.workspace_id = new.workspace_id)
       <> (select count(distinct x) from unnest(new.source_update_ids) x) then
    raise exception using errcode = '23514',
      message = 'WEEKLY_ORG_LINES_SOURCE: organization records must be in the same workspace';
  end if;
  if (tg_op = 'INSERT' or new.source_note_ids is distinct from old.source_note_ids)
     and (select count(distinct n.id) from public.app_notes n
          where n.id = any(new.source_note_ids) and n.workspace_id = new.workspace_id)
       <> (select count(distinct x) from unnest(new.source_note_ids) x) then
    raise exception using errcode = '23514',
      message = 'WEEKLY_ORG_LINES_SOURCE: notes must be in the same workspace';
  end if;
  if (tg_op = 'INSERT' or new.source_status_ids is distinct from old.source_status_ids)
     and (select count(distinct r.id) from public.app_org_status_rows r
          where r.id = any(new.source_status_ids) and r.workspace_id = new.workspace_id)
       <> (select count(distinct x) from unnest(new.source_status_ids) x) then
    raise exception using errcode = '23514',
      message = 'WEEKLY_ORG_LINES_SOURCE: status rows must be in the same workspace';
  end if;
  if tg_op = 'INSERT' and (
    select count(*) from public.app_weekly_org_lines l
    where l.workspace_id = new.workspace_id and l.week_start = new.week_start and l.organization_id = new.organization_id
  ) >= 40 then
    raise exception using errcode = '23514',
      message = 'WEEKLY_ORG_LINES_LIMIT: at most 40 lines per organization per week';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$guard$;
revoke all on function private.app_weekly_org_lines_guard() from public, anon, authenticated, service_role;

create trigger app_weekly_org_lines_guard
before insert or update on public.app_weekly_org_lines
for each row execute function private.app_weekly_org_lines_guard();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 지우기 권한 없음,
-- 범위 칸(workspace_id·organization_id·week_start·origin) 고칠 수 없음, 트리거 1개. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_weekly_org_lines'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_org_lines'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_weekly_org_lines'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_weekly_org_lines', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_weekly_org_lines', 'delete,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'organization_id', 'update')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'week_start', 'update')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'origin', 'update')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'updated_at', 'update')
     or has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'body', 'update')
     or not has_column_privilege('authenticated', 'public.app_weekly_org_lines', 'state', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_org_lines'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_org_lines'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_weekly_org_lines'::regclass and not tgisinternal) <> 1 then
    raise exception 'WEEKLY_ORG_LINES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104211500', 'weekly_org_lines', array['WEEKLY-메뉴짝짓기 P1: app_weekly_org_lines (owner RLS, no delete, same-workspace organization and source guard, 40 lines per organization per week, server updated_at)']);
commit;
