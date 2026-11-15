begin;
-- TODO-이미함·환류 DB 단계(요청함 11/01 17:58, 명진 결정 18:26, 설계 docs/design/todo-feedback.md 3절).
--  1) 챙길 것 후보 상태 검사식(app_todo_candidates_status_check)에 'done'([이미 함])을 더한다. 기존 3개 상태와 다른 검사식은 그대로다.
--     done은 처리한 때(decided_at)만 있고 할 일 id·할 일 기한은 없다(기존 decided·task·task_due 검사식이 그대로 맞음).
--  2) app_todo_feedback: 후보마다 누른 결과 한 줄(할 일로·이미 함·무시·내 일 아님) + 제안 당시 문장·출처 종류·고친 문장.
--     후보는 처리 30일 뒤 정리되지만 이 기록은 남아 다음 찾기의 예시·주간 비율에 쓰인다. 같은 후보는 한 줄만.
--  3) app_todo_rules: AI가 만든 규칙 후보와 명진이 확정·뺀 규칙(한 규칙 = 한 줄). 찾기는 확정만 쓴다.
-- 권한: 두 새 표 모두 작업공간 소유자(private.app_is_workspace_owner)만, 정책 하나씩.
--   feedback: authenticated = 읽기·넣기(정한 칸만)·지우기(되돌리기), 고치기 없음.
--   rules:    authenticated = 읽기·넣기(정한 칸만)·고치기(text·state·decided_at)·지우기.
--   anon·PUBLIC·service_role 표 권한 없음. 기존 표 권한·정책·자료는 바꾸지 않는다. 함수·트리거 없음.
-- 짝: docs/20261101180000_todo_feedback.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
-- 안 하는 것: 기존 후보 줄 변경, app_todo_not_mine·app_todo_ask_filter 변경, rtw_* 객체.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 검사식을 바꾸는 동안 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_todo_candidates in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101180000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261021075034' and name = 'todo_radar_candidates') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027060000' and name = 'todo_candidates_task_due') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_todo_candidates') is null
     or to_regclass('public.app_todo_feedback') is not null
     or to_regclass('public.app_todo_rules') is not null
     -- 지금 상태 검사식이 앞 단계 그대로(3개 상태)여야 한다.
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_todo_candidates')
         and conname = 'app_todo_candidates_status_check'
         and pg_get_constraintdef(oid) like '%open%' and pg_get_constraintdef(oid) like '%tasked%'
         and pg_get_constraintdef(oid) like '%dismissed%' and pg_get_constraintdef(oid) not like '%done%') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_todo_candidates')) <> 1
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TODO_FEEDBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_candidates drop constraint app_todo_candidates_status_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_status_check check (
  status in ('open', 'tasked', 'dismissed', 'done'));

create table public.app_todo_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  candidate_id uuid references public.app_todo_candidates(id) on delete set null,
  outcome text not null,
  kind text not null,
  source_kind text not null,
  summary text not null,
  edited text,
  created_at timestamptz not null default now(),
  constraint app_todo_feedback_outcome_check check (outcome in ('tasked', 'done', 'dismissed', 'not_mine')),
  constraint app_todo_feedback_kind_check check (kind in ('request', 'my_task', 'deadline', 'prepare', 'attend')),
  constraint app_todo_feedback_source_check check (
    source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'telegram')),
  constraint app_todo_feedback_summary_check check (
    char_length(btrim(summary)) between 1 and 100 and summary !~ '[[:cntrl:]]'),
  constraint app_todo_feedback_edited_check check (
    edited is null or (outcome = 'tasked' and char_length(btrim(edited)) between 1 and 200 and edited !~ '[[:cntrl:]]')),
  constraint app_todo_feedback_candidate_key unique (workspace_id, candidate_id)
);
create index app_todo_feedback_ws_idx on public.app_todo_feedback(workspace_id, created_at desc);
create index app_todo_feedback_candidate_idx on public.app_todo_feedback(candidate_id);

create table public.app_todo_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  text text not null,
  state text not null default 'candidate',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_todo_rules_state_check check (state in ('candidate', 'confirmed', 'retired')),
  constraint app_todo_rules_text_check check (
    char_length(btrim(text)) between 1 and 120 and text !~ '[[:cntrl:]]')
);
create index app_todo_rules_ws_idx on public.app_todo_rules(workspace_id, state, created_at desc);

alter table public.app_todo_feedback enable row level security;
alter table public.app_todo_rules enable row level security;
revoke all on table public.app_todo_feedback from public, anon, authenticated, service_role;
revoke all on table public.app_todo_rules from public, anon, authenticated, service_role;

grant select, delete on table public.app_todo_feedback to authenticated;
grant insert (workspace_id, candidate_id, outcome, kind, source_kind, summary, edited) on table public.app_todo_feedback to authenticated;
grant select, delete on table public.app_todo_rules to authenticated;
grant insert (workspace_id, text, state) on table public.app_todo_rules to authenticated;
grant update (text, state, decided_at) on table public.app_todo_rules to authenticated;

-- 결과 기록의 후보는 같은 작업공간의 후보여야 한다(없으면 비워 둠).
create policy todo_feedback_owner_all on public.app_todo_feedback for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (candidate_id is null or exists (
      select 1 from public.app_todo_candidates c
      where c.id = candidate_id and c.workspace_id = app_todo_feedback.workspace_id)));
create policy todo_rules_owner_all on public.app_todo_rules for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: 검사식에 done, 새 표 RLS 켜짐·authenticated 정책 하나씩, anon·PUBLIC·service_role 권한 없음,
-- feedback 고치기 없음, 기존 후보 표 정책 1개 그대로. 다르면 전체 취소.
do $$
declare f regclass := 'public.app_todo_feedback'::regclass; r regclass := 'public.app_todo_rules'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_todo_candidates'::regclass
      and conname = 'app_todo_candidates_status_check' and pg_get_constraintdef(oid) like '%done%' and convalidated) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_candidates'::regclass) <> 1
     or (select count(*) from pg_class where oid in (f, r) and relrowsecurity) <> 2
     or exists (select 1 from pg_class where oid in (f, r) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in (f, r) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', f, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', r, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', f, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', r, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', f, 'select,insert,update,references')
     or has_any_column_privilege('service_role', r, 'select,insert,update,references')
     or not has_table_privilege('authenticated', f, 'select,delete')
     or not has_table_privilege('authenticated', r, 'select,delete')
     or has_table_privilege('authenticated', f, 'insert,update,truncate,references,trigger')
     or has_table_privilege('authenticated', r, 'insert,update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', f, 'update')
     or not has_column_privilege('authenticated', f, 'summary', 'insert')
     or has_column_privilege('authenticated', f, 'id', 'insert')
     or has_column_privilege('authenticated', f, 'created_at', 'insert')
     or not has_column_privilege('authenticated', r, 'state', 'update')
     or has_column_privilege('authenticated', r, 'workspace_id', 'update')
     or has_column_privilege('authenticated', r, 'decided_at', 'insert')
     or (select count(*) from pg_policy where polrelid = f) <> 1
     or (select count(*) from pg_policy where polrelid = r) <> 1
     or exists (select 1 from pg_policy where polrelid in (f, r) and not (polroles = array[to_regrole('authenticated')::oid])) then
    raise exception 'TODO_FEEDBACK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101180000', 'todo_feedback', array['TODO-done-feedback: app_todo_candidates status check adds done; new owner-RLS tables app_todo_feedback (outcome log, no update) and app_todo_rules (rule candidates/confirmed/retired); no anon/PUBLIC/service_role privilege; existing grants and policies unchanged; no functions or triggers']);
commit;
