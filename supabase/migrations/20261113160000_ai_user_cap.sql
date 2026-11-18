begin;
-- AI-사람별한도(MULTI-노조사용자 단계 ③ 'AI 상한') DB. 명진 결정 11/13 14:43 "가": AI 비용은 명진이 내되 사람(작업공간)마다 한 달 한도,
-- 넘으면 그 사람 AI만 다음 달 1일(서울 날짜)까지 멈춤. 기본 한도 월 3,000원(CC 제안). 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
--  1) 운영자 기능 키에 'ai_no_cap'(이 한도에서 뺌)을 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261105100000_family_notes의 키 여섯은 그대로).
--     허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행 넣는다(고정 id·이름·메일 없음, dev_inbox·family와 같은 방식).
--  2) 새 표 public.app_workspace_ai_caps(workspace_id, monthly_cap_krw): 작업공간별 한도 한 칸. 행이 없으면 기본 3,000원.
--     RLS 켬, 정책 없음, anon·authenticated·service_role·PUBLIC 권한 없음 → 화면·API로는 읽지도 쓰지도 못한다. SQL로만 넣고 고친다.
--  3) 새 함수 셋(모두 SECURITY DEFINER, 빈 search_path):
--     private.app_ai_month_usage(p_workspace)  이번 달(서울 날짜) 그 작업공간의 AI 토큰 합계·한도·제외 여부. 아무 API 역할도 직접 못 부른다.
--       기존 사용 기록 표만 읽는다(새 기록 저장소 없음): app_ai_daily_usage(Web2 서버 AI 전체)·app_news_days.ai_*(뉴스·사회운동 [번역])
--       ·app_ai_external_usage(Gemini, 모델별). app_feed_days(텔레그램·통화 판정)는 운영자 기능에서만 줄이 생기고 운영자는 한도에서 빠지므로 읽지 않는다.
--       금액(원) 셈은 Edge 공용 함수(supabase/functions/_shared/ai-user-cap.mjs)가 단가표(_shared/ai-prices.mjs)로 한다(단가의 출처를 하나로 유지).
--     public.app_my_ai_month(p_workspace)       authenticated만. 로그인한 본인이 그 작업공간의 owner일 때만 답하고, 아니면 42501. 제외 여부는 private.app_workspace_has_feature.
--     public.app_workspace_ai_month(p_workspace) service_role만(Edge 서버가 확인한 작업공간으로 부름).
-- 안 하는 것: 기존 표·칸·정책·권한·함수 본문 변경, 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 짝: docs/20261113160000_ai_user_cap.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261105100000' and name = 'family_notes') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261028160000' and name = 'ai_usage_costs') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_ai_daily_usage') is null
     or to_regclass('public.app_news_days') is null
     or to_regclass('public.app_ai_external_usage') is null
     or to_regclass('public.app_workspace_ai_caps') is not null
     or to_regprocedure('private.app_ai_month_usage(uuid)') is not null
     or to_regprocedure('public.app_my_ai_month(uuid)') is not null
     or to_regprocedure('public.app_workspace_ai_month(uuid)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''family''' and pg_get_constraintdef(oid) !~ 'ai_no_cap') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family')) then
    raise exception 'AI_USER_CAP_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'AI_USER_CAP_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'ai_no_cap' from public.app_operator_features f where f.feature = 'calls';

create table public.app_workspace_ai_caps (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  monthly_cap_krw integer not null,
  updated_at timestamptz not null default now(),
  constraint app_workspace_ai_caps_krw_check check (monthly_cap_krw between 0 and 1000000)
);
alter table public.app_workspace_ai_caps enable row level security;
revoke all on table public.app_workspace_ai_caps from public, anon, authenticated, service_role;

create function private.app_ai_month_usage(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select pg_catalog.date_trunc('month', pg_catalog.timezone('Asia/Seoul', pg_catalog.now()))::date as m0
  ), r as (
    select b.m0, (b.m0 + interval '1 month')::date as m1 from b
  )
  select pg_catalog.jsonb_build_object(
    'month', pg_catalog.to_char(r.m0, 'YYYY-MM'),
    'exempt', exists (select 1 from public.app_operator_features f
                       where f.workspace_id = p_workspace and f.feature = 'ai_no_cap'),
    'cap_krw', coalesce((select c.monthly_cap_krw from public.app_workspace_ai_caps c where c.workspace_id = p_workspace), 3000),
    'openai_input_tokens',
      coalesce((select pg_catalog.sum(u.input_tokens) from public.app_ai_daily_usage u
                 where u.workspace_id = p_workspace and u.day >= r.m0 and u.day < r.m1), 0)
      + coalesce((select pg_catalog.sum(n.ai_input_tokens) from public.app_news_days n
                 where n.workspace_id = p_workspace and n.day >= r.m0 and n.day < r.m1), 0),
    'openai_output_tokens',
      coalesce((select pg_catalog.sum(u.output_tokens) from public.app_ai_daily_usage u
                 where u.workspace_id = p_workspace and u.day >= r.m0 and u.day < r.m1), 0)
      + coalesce((select pg_catalog.sum(n.ai_output_tokens) from public.app_news_days n
                 where n.workspace_id = p_workspace and n.day >= r.m0 and n.day < r.m1), 0),
    'gemini', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('model', g.model, 'input_tokens', g.i, 'audio_tokens', g.a, 'output_tokens', g.o) order by g.model)
        from (select e.model, pg_catalog.sum(e.input_tokens) as i, pg_catalog.sum(e.audio_tokens) as a, pg_catalog.sum(e.output_tokens) as o
                from public.app_ai_external_usage e
               where e.workspace_id = p_workspace and e.day >= r.m0 and e.day < r.m1
               group by e.model) g), '[]'::jsonb))
  from r
$$;
revoke all on function private.app_ai_month_usage(uuid) from public, anon, authenticated, service_role;

create function public.app_my_ai_month(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_workspace is null or not private.app_is_workspace_owner(p_workspace) then
    raise exception 'AI_MONTH_FORBIDDEN' using errcode = '42501';
  end if;
  return private.app_ai_month_usage(p_workspace)
    || pg_catalog.jsonb_build_object('exempt', private.app_workspace_has_feature(p_workspace, 'ai_no_cap'));
end
$$;
revoke all on function public.app_my_ai_month(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_my_ai_month(uuid) to authenticated;

create function public.app_workspace_ai_month(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_workspace is null then null else private.app_ai_month_usage(p_workspace) end
$$;
revoke all on function public.app_workspace_ai_month(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_workspace_ai_month(uuid) to service_role;

-- 사후 확인: 두 표 모두 RLS 켬·정책 없음·API 역할·PUBLIC 권한 없음, ai_no_cap 행은 calls와 같은 작업공간 1행,
-- 함수 셋은 DEFINER·빈 search_path, 실행권은 위에 적은 역할 하나씩(PUBLIC·anon 없음). 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_operator_features'::regclass, 'public.app_workspace_ai_caps'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_policy where polrelid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'AI_USER_CAP_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if (select count(*) from public.app_operator_features where feature = 'ai_no_cap') <> 1
     or (select count(*) from public.app_operator_features d join public.app_operator_features c
           on c.workspace_id = d.workspace_id and c.feature = 'calls' where d.feature = 'ai_no_cap') <> 1
     or exists (select 1 from pg_proc where oid in (to_regprocedure('private.app_ai_month_usage(uuid)'),
                  to_regprocedure('public.app_my_ai_month(uuid)'), to_regprocedure('public.app_workspace_ai_month(uuid)'))
                  and (not prosecdef or proconfig is distinct from array['search_path=""'] or proacl::text ~ '(^|[{,])(anon)?='))
     or has_function_privilege('anon', 'public.app_my_ai_month(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_my_ai_month(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_my_ai_month(uuid)', 'execute')
     or has_function_privilege('anon', 'public.app_workspace_ai_month(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.app_workspace_ai_month(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.app_workspace_ai_month(uuid)', 'execute')
     or has_function_privilege('anon', 'private.app_ai_month_usage(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.app_ai_month_usage(uuid)', 'execute')
     or has_function_privilege('service_role', 'private.app_ai_month_usage(uuid)', 'execute') then
    raise exception 'AI_USER_CAP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261113160000', 'ai_user_cap', array['AI-사람별한도: operator feature ai_no_cap added to app_operator_features_feature_check and seeded only for the single calls workspace; new table app_workspace_ai_caps (per-workspace monthly cap, RLS on, no policies, no API privileges, written only by SQL; default 3000 KRW when absent); new SECURITY DEFINER functions (empty search_path) private.app_ai_month_usage (no API role executes; sums this Seoul month of app_ai_daily_usage + app_news_days ai tokens and app_ai_external_usage per model), public.app_my_ai_month (authenticated, owner only, exempt via private.app_workspace_has_feature), public.app_workspace_ai_month (service_role only); no anon/PUBLIC, no change to existing tables, policies, grants or functions']);
commit;
