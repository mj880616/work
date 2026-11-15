begin;
-- JOURNAL-챙길것 1단계 + AI-서버연동 S5(docs/design/todo-radar.md 10·11절, docs/design/ai-server.md 5.2).
-- 새 표 2개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- 1) app_todo_candidates: 서버 ai-assist(kind=todo_radar)가 찾은 "챙길 것" 후보. 처리 전 후보와 처리 결과(할 일로/무시)만 둔다.
--    한 줄 요약(100자)·출처 종류와 id·출처 날짜·짧은 근거(200자)만 저장하고 원문은 옮기지 않는다.
--    같은 출처 + 같은 요약(dedupe_key)은 다시 넣지 않는다(무시한 후보도 다시 뜨지 않음).
--    상대·제3자 약속(COM)은 이 표에 넣지 않는다(화면이 [원장으로 복사]만, 결정 6).
-- 2) app_todo_radar_state: 작업공간마다 1행. 마지막으로 찾은 때(다음 찾기의 기준선)·오늘 찾은 횟수·실행 중 표시.
-- 둘 다 owner만 읽고 쓴다(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한과 공개 정책은 없다.
-- 정책·표 grant가 있어 승인형 DB workflow 검사가 거절하므로 SQL Editor(폰 경로 C) 전용. 짝: docs/20261021075034_todo_radar_candidates.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021075034')
     or to_regclass('public.app_todo_candidates') is not null
     or to_regclass('public.app_todo_radar_state') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef) then
    raise exception 'TODO_RADAR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 챙길 것 후보. kind: request(답할 요청)·my_task(내 할 일)·deadline(마감)·prepare(준비)·attend(참석).
-- source_kind: basket(업데이트)·note(노트)·work(일지 한 줄)·meeting(회의 결과)·org_update(조직 기록)·project_update(프로젝트 기록).
-- project_id·organization_id는 [할 일로]에서 같은 곳에 연결하려고 둔다(없을 수 있음).
create table public.app_todo_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null,
  summary text not null,
  due date,
  source_kind text not null,
  source_id uuid not null,
  source_day date not null,
  evidence text not null default '',
  dedupe_key text not null,
  project_id uuid references public.app_spaces(id) on delete set null,
  organization_id uuid references public.app_suborganizations(id) on delete set null,
  status text not null default 'open',
  task_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_todo_candidates_kind_check check (kind in ('request', 'my_task', 'deadline', 'prepare', 'attend')),
  constraint app_todo_candidates_source_kind_check check (
    source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update')),
  constraint app_todo_candidates_summary_check check (
    char_length(btrim(summary)) between 1 and 100 and summary !~ '[[:cntrl:]]'),
  constraint app_todo_candidates_evidence_check check (
    char_length(evidence) <= 200 and evidence !~ '[[:cntrl:]]'),
  constraint app_todo_candidates_dedupe_check check (char_length(dedupe_key) between 1 and 200),
  constraint app_todo_candidates_status_check check (status in ('open', 'tasked', 'dismissed')),
  constraint app_todo_candidates_task_check check (
    (status = 'tasked') = (task_id is not null) and (task_id is null or char_length(task_id) between 1 and 200)),
  constraint app_todo_candidates_decided_check check ((status = 'open') = (decided_at is null)),
  constraint app_todo_candidates_dedupe_key unique (workspace_id, dedupe_key)
);
create index app_todo_candidates_open_idx on public.app_todo_candidates(workspace_id, created_at desc) where status = 'open';
create index app_todo_candidates_day_idx on public.app_todo_candidates(workspace_id, source_day);

-- 찾기 상태(작업공간마다 1행). runs_on_day는 last_day(한국 날짜)에 찾은 횟수, running_since는 찾는 중 표시.
create table public.app_todo_radar_state (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  last_success_at timestamptz,
  last_partial boolean not null default false,
  last_day date,
  runs_on_day integer not null default 0,
  running_since timestamptz,
  updated_at timestamptz not null default now(),
  constraint app_todo_radar_state_runs_check check (runs_on_day between 0 and 1000)
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
-- authenticated: 읽기는 표 전체, 후보 삭제(오래된 처리 후보 정리), 쓰기는 필요한 칸만.
--   후보 넣기는 status·task_id·decided_at을 정할 수 없다(늘 open으로 들어옴). 후보 고치기는 처리 칸만(요약·출처는 못 바꿈).
alter table public.app_todo_candidates enable row level security;
alter table public.app_todo_radar_state enable row level security;
revoke all on table public.app_todo_candidates, public.app_todo_radar_state from public, anon, authenticated, service_role;
grant select, delete on table public.app_todo_candidates to authenticated;
grant insert (workspace_id, kind, summary, due, source_kind, source_id, source_day, evidence, dedupe_key, project_id, organization_id)
  on table public.app_todo_candidates to authenticated;
grant update (status, task_id, decided_at) on table public.app_todo_candidates to authenticated;
grant select on table public.app_todo_radar_state to authenticated;
grant insert (workspace_id) on table public.app_todo_radar_state to authenticated;
grant update (last_success_at, last_partial, last_day, runs_on_day, running_since, updated_at)
  on table public.app_todo_radar_state to authenticated;

create policy todo_candidates_owner_all on public.app_todo_candidates for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and private.app_space_in_workspace(project_id, workspace_id)
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_todo_candidates.workspace_id)));

create policy todo_radar_state_owner_all on public.app_todo_radar_state for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC·service_role 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_todo_candidates'::regclass, 'public.app_todo_radar_state'::regclass)
             and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_todo_candidates'::regclass, 'public.app_todo_radar_state'::regclass)
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_todo_candidates'::regclass, 'public.app_todo_radar_state'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_candidates'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_radar_state'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_todo_candidates'::regclass, 'public.app_todo_radar_state'::regclass)) <> 2 then
    raise exception 'TODO_RADAR_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021075034', 'todo_radar_candidates', array['JOURNAL-챙길것 1단계/AI S5: app_todo_candidates + app_todo_radar_state, owner RLS, no anon/service_role']);
commit;
