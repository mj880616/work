begin;
-- FEAT-1029묶음 ② 1/3 DB(설계 docs/design/pre-meeting-sheet.md 5절, 명진 결정 10/29 07:27 '모두 추천대로'): 교섭·회의 전 한 장을 담는 표.
-- 바꾸는 것: 새 표 1개(app_pre_meeting_sheets, 일정마다 1행)와 그 표의 트리거 함수 1개. 기존 표·정책·권한·함수·자료는 한 줄도 바꾸지 않는다.
--  - 행: 작업공간·일정 키(캘린더 id + 일정 id)·담당조직·만든 때 일정 값(제목·시작·끝·장소)·핵심 세 가지·①~⑦ 묶음 줄·AI 결과·만든 방식·시각.
--  - 쓰는 곳: ai-assist kind=pre_meeting_sheet(내 로그인 토큰, owner RLS)만 넣고 고친다([다시 만들기]는 덮어씀). 화면은 읽기만 한다.
--  - 모양(top_lines·groups·ai_status·made_by)은 다음 주 준비 한 장(app_journal_next_week_sheets)과 같다(화면 모델 공용).
--  - 트리거: 담당조직은 같은 작업공간이어야 한다(남의 작업공간 조직 거절). 조직을 지우면 그 조직의 장도 함께 지운다.
-- 권한: owner만(private.app_is_workspace_owner). authenticated: 읽기, 넣기(칸 11개), 고치기(칸 10개). 지우기 없음(지난 장은 교섭 기록으로 남김).
--  anon·PUBLIC·service_role 권한 없음. workspace_id·event_key·created_at은 고칠 수 없다.
-- 짝: docs/20261029070000_pre_meeting_sheets.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029070000')
     or to_regclass('public.app_pre_meeting_sheets') is not null
     or to_regprocedure('private.app_pre_meeting_sheets_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'PRE_MEETING_SHEETS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_pre_meeting_sheets (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  event_key text not null,
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  event_title text not null,
  event_start timestamptz not null,
  event_end timestamptz,
  event_location text,
  top_lines jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  ai_status text not null,
  made_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, event_key),
  constraint app_pre_meeting_sheets_key_check check (
    char_length(event_key) between 3 and 600 and event_key !~ '[[:cntrl:][:space:]]'),
  constraint app_pre_meeting_sheets_title_check check (
    char_length(event_title) between 1 and 300 and event_title !~ '[[:cntrl:]]'),
  constraint app_pre_meeting_sheets_location_check check (
    event_location is null or (char_length(event_location) between 1 and 300 and event_location !~ '[[:cntrl:]]')),
  constraint app_pre_meeting_sheets_time_check check (event_end is null or event_end >= event_start),
  constraint app_pre_meeting_sheets_top_check check (
    jsonb_typeof(top_lines) = 'array' and jsonb_array_length(top_lines) <= 3),
  constraint app_pre_meeting_sheets_groups_check check (
    jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) <= 200 and pg_column_size(groups) <= 65536),
  constraint app_pre_meeting_sheets_ai_check check (ai_status in ('ok', 'limit', 'failed', 'skipped')),
  constraint app_pre_meeting_sheets_made_check check (made_by in ('auto', 'user'))
);
-- 담당조직 상세의 '다가오는 교섭'·'지난 한 장 n' 줄을 위한 색인.
create index app_pre_meeting_sheets_org_idx on public.app_pre_meeting_sheets(workspace_id, organization_id, event_start desc);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기, 넣기·고치기는 필요한 칸만.
alter table public.app_pre_meeting_sheets enable row level security;
revoke all on table public.app_pre_meeting_sheets from public, anon, authenticated, service_role;
grant select on table public.app_pre_meeting_sheets to authenticated;
grant insert (workspace_id, event_key, organization_id, event_title, event_start, event_end, event_location,
  top_lines, groups, ai_status, made_by) on table public.app_pre_meeting_sheets to authenticated;
grant update (organization_id, event_title, event_start, event_end, event_location,
  top_lines, groups, ai_status, made_by, updated_at) on table public.app_pre_meeting_sheets to authenticated;

create policy pre_meeting_sheets_owner_all on public.app_pre_meeting_sheets for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 담당조직은 같은 작업공간이어야 한다(넣을 때·조직을 바꿀 때).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'PRE_MEETING_SHEETS_SCOPE:'.
create function private.app_pre_meeting_sheets_guard()
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
      message = 'PRE_MEETING_SHEETS_SCOPE: organization must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_pre_meeting_sheets_guard() from public, anon, authenticated, service_role;

create trigger app_pre_meeting_sheets_guard
before insert or update of organization_id, workspace_id on public.app_pre_meeting_sheets
for each row execute function private.app_pre_meeting_sheets_guard();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 지우기·키 고치기 권한 없음, 트리거 1개. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_pre_meeting_sheets'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_pre_meeting_sheets'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_pre_meeting_sheets'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_pre_meeting_sheets', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_pre_meeting_sheets', 'delete,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'event_key', 'update')
     or has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'created_at', 'update')
     or has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'groups', 'insert')
     or not has_column_privilege('authenticated', 'public.app_pre_meeting_sheets', 'groups', 'update')
     or not has_table_privilege('authenticated', 'public.app_pre_meeting_sheets', 'select')
     or (select count(*) from pg_policy where polrelid = 'public.app_pre_meeting_sheets'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_pre_meeting_sheets'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_pre_meeting_sheets'::regclass and not tgisinternal) <> 1 then
    raise exception 'PRE_MEETING_SHEETS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029070000', 'pre_meeting_sheets', array['FEAT-1029 ②: app_pre_meeting_sheets (owner RLS, one sheet per calendar event, same-workspace organization guard, no delete)']);
commit;
