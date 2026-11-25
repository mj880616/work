begin;
-- AI-비용보기 4단계 DB(설계 docs/design/ai-cost-view.md 2.2절 (가)·(나), 명진 결정 2026-11-25 "추천대로").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) 새 표 public.app_ai_usage_events: Web2 서버 AI(OpenAI)를 한 번 묶어 부를 때마다 기능 키별로 1행(넣기만, 고치기·지우기 없음).
--     칸은 작업공간·서울 날짜·기능 키·공급자·모델 이름·호출 수·입력/출력 토큰·시각뿐. 재료 글·AI 답·파일 이름 같은 내용 칸은 두지 않는다.
--     금액(원)은 칸으로 두지 않는다: 단가 출처를 _shared/ai-prices.mjs 한 곳으로 두고 서버(drive-summary)가 토큰으로 셈한다.
--     하루 한도(app_ai_daily_usage.requests)와 월 상한 판정은 지금 표 그대로다. 이 표는 옆에 더하기만 한다.
--  2) app_ai_cost_entries.kind에 'cap'(Gemini 후불 월 지출 한도)·'reload'(OpenAI 자동 충전 금액)를 더한다.
--     같은 이름 검사 두 개(kind·month)를 지우고 다시 만든다. 있던 'topup'·'bill' 규칙은 그대로, 새 두 종류는 month 없음(가장 최근 값을 쓴다).
--
-- 권한(새 표만, app_ai_external_usage와 같은 모양):
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만 읽기 + 넣기 칸 grant(소유자 with check). 고치기·지우기 없음.
--   service_role: 넣기 칸 grant만(읽기·고치기·지우기 없음).
--   anon·PUBLIC: 없음. RLS 켬.
-- 안 하는 것: app_ai_cost_entries의 권한·정책·칸 변경, 기존 줄 변경·삭제, 함수·트리거, rtw_* 객체. 화면·Edge는 아직 이 표를 쓰지 않는다(5단계).
-- 짝: docs/20261125235000_ai_usage_events.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.app_ai_cost_entries') is null then
    raise exception 'AI_USAGE_EVENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;
lock table public.app_ai_cost_entries in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125235000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261028160000' and name = 'ai_usage_costs') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_ai_usage_events') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_constraint where conrelid = 'public.app_ai_cost_entries'::regclass
         and conname = 'app_ai_cost_entries_kind_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''topup''' and pg_get_constraintdef(oid) ~ '''bill'''
         and pg_get_constraintdef(oid) !~ '''cap''' and pg_get_constraintdef(oid) !~ '''reload''') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_ai_cost_entries'::regclass
         and conname = 'app_ai_cost_entries_month_check' and contype = 'c' and convalidated) <> 1
     or exists (select 1 from public.app_ai_cost_entries where kind not in ('topup', 'bill')) then
    raise exception 'AI_USAGE_EVENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_ai_cost_entries drop constraint app_ai_cost_entries_kind_check;
alter table public.app_ai_cost_entries add constraint app_ai_cost_entries_kind_check
  check (kind in ('topup', 'bill', 'cap', 'reload'));
alter table public.app_ai_cost_entries drop constraint app_ai_cost_entries_month_check;
alter table public.app_ai_cost_entries add constraint app_ai_cost_entries_month_check check (
  (kind in ('topup', 'cap', 'reload') and month is null)
  or (kind = 'bill' and month is not null and extract(day from month) = 1 and month >= date '2026-01-01'));

create table public.app_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  feature text not null,
  provider text not null,
  model text not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint app_ai_usage_events_day_check check (day >= date '2026-01-01'),
  constraint app_ai_usage_events_feature_check check (feature in
    ('ledger', 'journal', 'ask', 'todo', 'library', 'meeting', 'org', 'telegram', 'call_judge', 'news', 'other')),
  constraint app_ai_usage_events_provider_check check (provider in ('openai')),
  constraint app_ai_usage_events_model_check check (model ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint app_ai_usage_events_numbers_check check (calls between 0 and 10000
    and input_tokens between 0 and 1000000000 and output_tokens between 0 and 1000000000)
);
create index app_ai_usage_events_day_idx on public.app_ai_usage_events(workspace_id, day);

alter table public.app_ai_usage_events enable row level security;
revoke all on table public.app_ai_usage_events from public, anon, authenticated, service_role;

grant select on table public.app_ai_usage_events to authenticated;
grant insert (workspace_id, day, feature, provider, model, calls, input_tokens, output_tokens)
  on table public.app_ai_usage_events to authenticated;
grant insert (workspace_id, day, feature, provider, model, calls, input_tokens, output_tokens)
  on table public.app_ai_usage_events to service_role;

create policy ai_usage_events_owner_read on public.app_ai_usage_events for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy ai_usage_events_owner_insert on public.app_ai_usage_events for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 2개(authenticated만), anon·PUBLIC 권한 없음, authenticated는 읽기 + 넣기 칸만(id·created_at 넣기 없음),
-- service_role은 넣기 칸만(읽기·고치기·지우기 없음), 누구도 고치기·지우기 없음, 금액 표 새 검사 두 개. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_ai_usage_events'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'update,references')
     or not has_column_privilege('authenticated', t, 'feature', 'insert')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or has_column_privilege('authenticated', t, 'created_at', 'insert')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,update,references')
     or not has_column_privilege('service_role', t, 'feature', 'insert')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'created_at', 'insert')
     or (select count(*) from pg_policy where polrelid = t) <> 2
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or (select count(*) from pg_constraint where conrelid = 'public.app_ai_cost_entries'::regclass
         and conname in ('app_ai_cost_entries_kind_check', 'app_ai_cost_entries_month_check')
         and pg_get_constraintdef(oid) ~ '''reload''') <> 2 then
    raise exception 'AI_USAGE_EVENTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125235000', 'ai_usage_events', array['AI-비용보기 4단계: app_ai_usage_events (insert only; owner read + owner column insert for authenticated, column insert only for service_role; no content columns) + app_ai_cost_entries kind/month checks add cap and reload (month null); no anon/PUBLIC, no change to existing grants, policies or rows']);
commit;
