begin;
-- AI-사용량줄 1단계 DB. 홈 수집 칸 아래 'AI 사용량' 줄이 읽는 숫자 중 지금 기록이 없는 두 가지만 새 표로 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_ai_external_usage: Web2 밖 스크립트(회사 PC 전사·분석, Gemini)가 AI를 부를 때 돌려받은 사용량(토큰) 보고 한 건 = 한 행.
--     보고마다 스크립트가 만든 ref(같은 보고를 두 번 보내도 한 번만 들어감)·모델 이름·호출 수·입력/음성/출력 토큰·서울 날짜만 둔다.
--     재료 글·전사 글·AI 답은 받지도 두지도 않는다. 쓰는 곳은 Edge drive-summary(POST ?action=ai_usage, 수집 점검 신호와 같은 비밀값)뿐.
--  2) app_ai_cost_entries: 명진이 홈에서 직접 넣는 금액 — OpenAI·Gemini 충전 금액(topup), 한 달 실제 청구 금액(bill, 그 달 1일).
--     고치기는 없고 새로 넣기·지우기만 한다(가장 최근 값을 쓴다).
-- Web2 서버 AI(OpenAI) 사용량은 이미 app_ai_daily_usage(ai-assist)·app_feed_days.ai_*(collector-feed)에 있어 여기서 바꾸지 않는다.
--
-- 권한: 새 표 2개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   authenticated: 두 표 모두 작업공간 소유자(private.app_is_workspace_owner)만 읽기. app_ai_cost_entries는 소유자만 넣기·지우기(칸 4개 넣기 grant).
--   service_role: app_ai_external_usage 넣기(칸 grant)만. 읽기·고치기·지우기 없음. app_ai_cost_entries 권한 없음.
--   anon·PUBLIC: 없음.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경. 화면·Edge가 아직 이 표를 쓰지 않으므로 지금 화면은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028160000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_ai_external_usage') is not null
     or to_regclass('public.app_ai_cost_entries') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'AI_USAGE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_ai_external_usage (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  ref text not null,
  provider text not null,
  source text not null,
  model text not null,
  day date not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  audio_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (workspace_id, ref),
  constraint app_ai_external_usage_ref_check check (ref ~ '^[A-Za-z0-9_.:-]{8,80}$'),
  constraint app_ai_external_usage_provider_check check (provider in ('gemini')),
  constraint app_ai_external_usage_source_check check (source in ('transcript', 'analysis')),
  constraint app_ai_external_usage_model_check check (model ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint app_ai_external_usage_numbers_check check (calls between 0 and 10000
    and input_tokens between 0 and 1000000000 and audio_tokens between 0 and input_tokens
    and output_tokens between 0 and 1000000000)
);
create index app_ai_external_usage_day_idx on public.app_ai_external_usage(workspace_id, day);

create table public.app_ai_cost_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  provider text not null,
  kind text not null,
  amount_krw integer not null,
  month date,
  created_at timestamptz not null default now(),
  constraint app_ai_cost_entries_provider_check check (provider in ('openai', 'gemini')),
  constraint app_ai_cost_entries_kind_check check (kind in ('topup', 'bill')),
  constraint app_ai_cost_entries_amount_check check (amount_krw between 0 and 100000000),
  constraint app_ai_cost_entries_month_check check (
    (kind = 'topup' and month is null)
    or (kind = 'bill' and month is not null and extract(day from month) = 1 and month >= date '2026-01-01'))
);
create index app_ai_cost_entries_ws_idx on public.app_ai_cost_entries(workspace_id, created_at desc);

alter table public.app_ai_external_usage enable row level security;
alter table public.app_ai_cost_entries enable row level security;
revoke all on table public.app_ai_external_usage from public, anon, authenticated, service_role;
revoke all on table public.app_ai_cost_entries from public, anon, authenticated, service_role;

grant select on table public.app_ai_external_usage to authenticated;
grant insert (workspace_id, ref, provider, source, model, day, calls, input_tokens, audio_tokens, output_tokens)
  on table public.app_ai_external_usage to service_role;
grant select, delete on table public.app_ai_cost_entries to authenticated;
grant insert (workspace_id, provider, kind, amount_krw, month) on table public.app_ai_cost_entries to authenticated;

create policy ai_external_usage_owner_read on public.app_ai_external_usage for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy ai_cost_entries_owner_read on public.app_ai_cost_entries for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy ai_cost_entries_owner_insert on public.app_ai_cost_entries for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id));
create policy ai_cost_entries_owner_delete on public.app_ai_cost_entries for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 4개(위 이름 그대로), anon·PUBLIC 권한 없음, authenticated는 읽기(+금액 표 넣기 칸·지우기)만,
-- service_role은 사용량 표 넣기 칸만(읽기·고치기·지우기 없음)·금액 표 권한 없음. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_ai_external_usage'::regclass, 'public.app_ai_cost_entries'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'update,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'update,references')
       or not has_table_privilege('authenticated', t, 'select')
       or has_table_privilege('service_role', t, 'select,update,delete,truncate,references,trigger')
       or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid])) then
      raise exception 'AI_USAGE_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if (select count(*) from pg_policy where polrelid = 'public.app_ai_external_usage'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_ai_cost_entries'::regclass) <> 3
     or has_any_column_privilege('authenticated', 'public.app_ai_external_usage', 'insert')
     or has_table_privilege('authenticated', 'public.app_ai_external_usage', 'delete')
     or not has_column_privilege('authenticated', 'public.app_ai_cost_entries', 'amount_krw', 'insert')
     or has_column_privilege('authenticated', 'public.app_ai_cost_entries', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_ai_cost_entries', 'created_at', 'insert')
     or not has_table_privilege('authenticated', 'public.app_ai_cost_entries', 'delete')
     or not has_column_privilege('service_role', 'public.app_ai_external_usage', 'ref', 'insert')
     or has_column_privilege('service_role', 'public.app_ai_external_usage', 'created_at', 'insert')
     or has_any_column_privilege('service_role', 'public.app_ai_cost_entries', 'select,insert,update,references') then
    raise exception 'AI_USAGE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028160000', 'ai_usage_costs', array['AI-사용량줄: app_ai_external_usage (owner read, service_role column insert only) + app_ai_cost_entries (owner read/insert/delete, no service_role)']);
commit;
