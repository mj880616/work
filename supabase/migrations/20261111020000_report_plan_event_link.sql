begin;
-- S57-7 BIZ-보고할일정 1단계 DB(요청함 2026-11-11 07:03 → 07:08 접수, ①~⑤ 승인. 설계 docs/design/biz-report-plan-link.md, 시안 docs/design/mockups/biz-report-plan-link.html).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). 화면은 다음 PR.
--
-- 무엇(Expand만, 기존 칸·기록은 그대로):
--   1) 새 표 app_calendar_report_plans — 일정(Google Calendar) 하나에 줄 하나, '보고할 일정' 결정을 서버에 적는다.
--      state: on 보고할 일정 · off 끔(이 일정만) · skip 빼기(다시 묻지 않음). decided_by: user 사람 · rule 같은 이름 기억으로 저절로 켜짐(rule은 on만).
--      decided_at: 결정한 때(같은 이름 기억은 사람이 정한 on·skip 중 가장 나중 줄 — 따로 기억 칸 없음). title·event_day·starts_at: 일정 제목·날짜·시각 사본
--      ('안 쓴 보고' 줄과 사업 보고 달력이 Google을 다시 부르지 않고 그리려고). 작업공간 안에서 일정 id 하나에 줄 하나.
--   2) 사업 보고 표 app_meetings에 칸 둘 google_calendar_id·google_event_id(둘 다 비워도 됨, 기본값 없음 → 표를 다시 쓰지 않고 기존 행은 모두 null).
--      검사 셋(둘 다 비었거나 둘 다 채움 · 일정 id 글자 · 캘린더 id 글자)과 색인 하나(작업공간·일정 id, 채운 줄만).
--      app_project_milestones의 Google 연결 칸과 같은 이름·같은 짝 규칙이다.
-- 권한: 새 표는 owner 정책 하나(authenticated만, private.app_is_workspace_owner). authenticated: 읽기·지우기(표 단위), 넣기·고치기는 값 칸만
--   (workspace_id·google_event_id·id·created_at은 못 고침). anon·PUBLIC·service_role: 없음.
--   app_meetings는 grant·정책·RLS 변경 없음(기존 표 단위 권한 그대로 — 새 칸도 소유자만 읽고 씀).
-- 안 하는 것: 함수·트리거·view·시퀀스, 기존 정책·권한·다른 칸·다른 검사 변경, 기존 행 변경(연결 채우기는 따로), rtw 객체.
-- 짝: docs/20261111020000_report_plan_event_link.{precheck,snapshot,postcheck,rollback,preserve}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(pg_catalog만 읽는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261111020000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_calendar_report_plans') is not null
     or to_regclass('public.app_meetings_google_event_idx') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     -- 사업 보고 표: 작업공간 칸·휴지통 칸이 있고, 새 칸·새 검사는 아직 없다.
     or (select count(*) from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname in ('workspace_id', 'deleted_at')) <> 2
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname in ('google_calendar_id', 'google_event_id'))
     or exists (select 1 from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname in ('app_meetings_google_link_pair_check', 'app_meetings_google_event_id_check', 'app_meetings_google_calendar_id_check'))
     -- app_meetings: RLS 켜짐, anon·PUBLIC 표 권한 없음.
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     -- 넓히는(permissive) 정책은 task12a 한 개 그대로(소유자만).
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.app_meetings'::regclass
         and polname = 'task12a_owner_all' and polpermissive and polcmd = '*'
         and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') then
    raise exception 'REPORT_PLAN_EVENT_LINK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_calendar_report_plans (
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  google_event_id text not null,
  google_calendar_id text not null,
  state text not null,
  decided_by text not null default 'user',
  decided_at timestamptz not null default now(),
  title text not null,
  event_day date not null,
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_calendar_report_plans_pkey primary key (id),
  constraint app_calendar_report_plans_event_key unique (workspace_id, google_event_id),
  -- 일정 id: 빈칸·제어 글자 없는 ASCII 1~1024자(Google 일정 id 범위).
  constraint app_calendar_report_plans_event_id_check check (
    char_length(google_event_id) between 1 and 1024 and google_event_id !~ '[^!-~]'),
  constraint app_calendar_report_plans_calendar_id_check check (
    char_length(google_calendar_id) between 1 and 255 and google_calendar_id !~ '[[:cntrl:][:space:]]'),
  constraint app_calendar_report_plans_state_check check (state in ('on', 'off', 'skip')),
  -- 저절로 켜진 줄(rule)은 on뿐이다. 끔·빼기는 사람만 정한다.
  constraint app_calendar_report_plans_decided_by_check check (
    decided_by in ('user', 'rule') and (decided_by = 'user' or state = 'on')),
  constraint app_calendar_report_plans_title_check check (
    char_length(title) <= 300 and char_length(btrim(title)) >= 1 and title !~ '[[:cntrl:]]'),
  constraint app_calendar_report_plans_day_check check (
    event_day between date '2000-01-01' and date '2100-12-31')
);
create index app_calendar_report_plans_day_idx on public.app_calendar_report_plans (workspace_id, event_day desc);

alter table public.app_calendar_report_plans enable row level security;
revoke all on table public.app_calendar_report_plans from public, anon, authenticated, service_role;

grant select, delete on table public.app_calendar_report_plans to authenticated;
grant insert (id, workspace_id, google_event_id, google_calendar_id, state, decided_by, decided_at, title, event_day, starts_at)
  on table public.app_calendar_report_plans to authenticated;
grant update (google_calendar_id, state, decided_by, decided_at, title, event_day, starts_at)
  on table public.app_calendar_report_plans to authenticated;

create policy calendar_report_plans_owner_all on public.app_calendar_report_plans for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

alter table public.app_meetings
  add column google_calendar_id text,
  add column google_event_id text,
  add constraint app_meetings_google_link_pair_check check ((google_calendar_id is null) = (google_event_id is null)),
  add constraint app_meetings_google_event_id_check check (
    google_event_id is null or (char_length(google_event_id) between 1 and 1024 and google_event_id !~ '[^!-~]')),
  add constraint app_meetings_google_calendar_id_check check (
    google_calendar_id is null or (char_length(google_calendar_id) between 1 and 255 and google_calendar_id !~ '[[:cntrl:][:space:]]'));
create index app_meetings_google_event_idx on public.app_meetings (workspace_id, google_event_id)
  where google_event_id is not null;

-- 사후 확인: 새 표는 RLS 켜짐·정책 하나(authenticated)·anon·PUBLIC·service_role 권한 없음·값 칸만 넣고 고침·빈 표.
--   사업 보고 표는 권한 경계 그대로, 새 칸 둘은 text·null 허용·기본값 없음·모두 null, 새 검사 셋·색인 하나, 넓히는 정책은 여전히 하나. 다르면 전체 취소.
do $$
declare
  t regclass := 'public.app_calendar_report_plans'::regclass;
  m regclass := 'public.app_meetings'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or not has_table_privilege('authenticated', t, 'delete')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or not has_column_privilege('authenticated', t, 'workspace_id', 'insert')
     or not has_column_privilege('authenticated', t, 'google_event_id', 'insert')
     or not has_column_privilege('authenticated', t, 'state', 'insert,update')
     or not has_column_privilege('authenticated', t, 'title', 'insert,update')
     or has_column_privilege('authenticated', t, 'created_at', 'insert,update')
     or has_column_privilege('authenticated', t, 'id', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'google_event_id', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or exists (select 1 from pg_policy where polrelid = t and not polpermissive)
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0
     or exists (select 1 from public.app_calendar_report_plans)
     or exists (select 1 from pg_class where oid = m and not relrowsecurity)
     or exists (select 1 from pg_class where oid = m and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = m and polpermissive) <> 1
     or (select count(*) from pg_attribute a
         where a.attrelid = m and not a.attisdropped and a.attname in ('google_calendar_id', 'google_event_id')
           and a.atttypid = 'text'::regtype and not a.attnotnull and not a.atthasdef and a.attacl is null) <> 2
     or (select count(*) from pg_constraint where conrelid = m and contype = 'c' and convalidated
         and conname in ('app_meetings_google_link_pair_check', 'app_meetings_google_event_id_check', 'app_meetings_google_calendar_id_check')) <> 3
     or (select count(*) from pg_index i where i.indexrelid = to_regclass('public.app_meetings_google_event_idx')
         and i.indrelid = m and i.indisvalid and not i.indisunique and i.indpred is not null) <> 1
     or exists (select 1 from public.app_meetings where google_calendar_id is not null or google_event_id is not null) then
    raise exception 'REPORT_PLAN_EVENT_LINK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261111020000', 'report_plan_event_link', array['S57-7 BIZ report plans: app_calendar_report_plans (one row per workspace and Google event: state on|off|skip, decided_by user|rule, decided_at, title/event_day/starts_at copy; owner RLS, authenticated select/delete + insert/update value columns, no anon/PUBLIC/service_role) + app_meetings.google_calendar_id/google_event_id text null (pair check, id shape checks, partial index); no functions/triggers, no grant or policy change on existing tables, no row change']);
commit;
