begin;
-- S51-10 NEWS-전면개편 P3a — DB: 수집·미리 만들기 AI 사용량 하루 표 public.app_feed_ai_days + 상세 분류 꼬리표 칸 app_now_details.topic.
-- 설계: docs/design/news-overhaul.md 5.4절(사용량 새 표)·5.5절(P3a)·6.3절(분류 꼬리표 topic). 명진 결정 M1(2026-11-06): 미리 만들기 한 달 상한 10,000원.
-- 한 달 상한 값은 이 표에 두지 않는다. 지금 ai-assist 월 15,000원이 Edge 상수(supabase/functions/ai-assist/handler.ts MONTHLY_LIMIT_KRW)인 것과 같이
-- P3c가 수집 함수 쪽 Edge 상수로 둔다. 이 migration은 표와 칸만 만든다(값·줄을 넣지 않는다).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- Edge·화면 변경은 이 migration에 없다(P3c가 줄을 넣고 drive-summary ai_usage가 읽음). 그 전까지 새 표는 비어 있고 topic은 모두 null이다.
--
-- 무엇:
--   1) 새 표 public.app_feed_ai_days: 작업공간·날짜·기능마다 한 줄. 기능(feature)은
--      outside_summary(사회운동 수집 요약 — 지금 기록 없음, 설계 1.5)·news_summary(언론 수집 요약)·prebuild(요약·시사점 미리 만들기) 셋.
--      칸: requests(요청 수)·input_tokens·output_tokens(토큰)·cost_krw(추정 원, 소수 넷째 자리)·updated_at.
--      (workspace_id, day, feature) 유일. 칸 검사: 모두 0 이상, 하루 요청 100,000·토큰 10억·원 1,000,000 이하. 작업공간이 지워지면 함께 지워진다.
--   2) 기존 표 public.app_now_details에 칸 topic 하나: labor(노동)·politics(정치)·economy(경제)·society(사회) 중 하나 또는 null(기본 null).
--      기존 줄은 null로 남고 바뀌지 않는다. 표 단위 권한이라 새 칸 권한은 기존과 같다(소유자 읽기, service_role 넣기·고치기).
-- 권한(새 표): RLS 켬. 정책은 소유자 읽기 하나(authenticated만, private.app_is_workspace_owner — app_news_days·app_ai_daily_usage를 홈 'AI 사용량'이
--   소유자 토큰으로 읽는 방식과 같음). authenticated는 읽기만. service_role(수집 Edge)은 읽기·칸별 넣기·칸별 고치기(upsert)만, 지우기 없음.
--   anon·PUBLIC 권한 없음. 운영자 전용 아님(News는 모든 작업공간 기능).
-- 안 하는 것: app_now_details의 다른 칸·검사·정책·권한·트리거 변경, 기존 줄 변경, 새 함수, 상한 값 저장, 공개·공유 경로, 운영자 기능 키, rtw_* 객체.
-- 짝: docs/20261106100000_feed_ai_days.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102140000' and name = 'now_detail') <> 1
     or to_regclass('public.app_feed_ai_days') is not null
     or to_regclass('public.app_now_details') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_now_details') and attname = 'topic' and not attisdropped)
     or exists (select 1 from pg_constraint where conname in ('app_now_details_topic_check'))
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'FEED_AI_DAYS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_ai_days (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  feature text not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_krw numeric(12, 4) not null default 0,
  updated_at timestamptz not null default now(),
  constraint app_feed_ai_days_pkey primary key (workspace_id, day, feature),
  constraint app_feed_ai_days_feature_check check (feature in ('outside_summary', 'news_summary', 'prebuild')),
  constraint app_feed_ai_days_counts_check check (
    requests between 0 and 100000
    and input_tokens between 0 and 1000000000
    and output_tokens between 0 and 1000000000
    and cost_krw between 0 and 1000000)
);
alter table public.app_feed_ai_days enable row level security;
revoke all on table public.app_feed_ai_days from public, anon, authenticated, service_role;
create policy feed_ai_days_owner_select on public.app_feed_ai_days
  for select to authenticated using (private.app_is_workspace_owner(workspace_id));
grant select on table public.app_feed_ai_days to authenticated;
-- 서버(수집 Edge): 읽기 + 칸별 넣기 + 칸별 고치기(같은 날·기능 줄에 더하기, upsert). 지우기는 없다(작업공간이 지워질 때 cascade로만).
grant select on table public.app_feed_ai_days to service_role;
grant insert (workspace_id, day, feature, requests, input_tokens, output_tokens, cost_krw)
  on table public.app_feed_ai_days to service_role;
grant update (workspace_id, day, feature, requests, input_tokens, output_tokens, cost_krw, updated_at)
  on table public.app_feed_ai_days to service_role;

-- 분류 꼬리표(6.3): 미리 만들기 때 AI가 고르는 주제 하나. 비어 있으면 화면은 꼬리표를 쓰지 않는다.
alter table public.app_now_details
  add column topic text constraint app_now_details_topic_check check (topic is null or topic in ('labor', 'politics', 'economy', 'society'));

-- 마지막 확인: 어긋나면 전체 취소.
do $$
declare
  t regclass := 'public.app_feed_ai_days'::regclass;
  d regclass := 'public.app_now_details'::regclass;
begin
  if not exists (select 1 from pg_class where oid = t and relrowsecurity and not relforcerowsecurity)
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polcmd = 'r' and polpermissive
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_class where oid = t and coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|authenticated)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('service_role', t, 'requests', 'insert')
     or not has_column_privilege('service_role', t, 'cost_krw', 'update')
     or has_column_privilege('service_role', t, 'updated_at', 'insert')
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0
     or (select count(*) from pg_attribute where attrelid = d and attname = 'topic' and atttypid = 'text'::regtype
         and not attnotnull and not atthasdef and not attisdropped) <> 1
     or (select count(*) from pg_constraint where conrelid = d and conname = 'app_now_details_topic_check' and contype = 'c') <> 1
     or exists (select 1 from pg_attribute where attrelid = d and attname = 'topic' and attacl is not null)
     or has_table_privilege('anon', d, 'select,insert,update,delete')
     or has_any_column_privilege('authenticated', d, 'insert,update')
     or not has_column_privilege('authenticated', d, 'topic', 'select')
     or not has_column_privilege('service_role', d, 'topic', 'insert')
     or not has_column_privilege('service_role', d, 'topic', 'update') then
    raise exception 'FEED_AI_DAYS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261106100000', 'feed_ai_days', array['S51-10 NEWS-전면개편 P3a: new table app_feed_ai_days (one row per workspace, day and feature outside_summary/news_summary/prebuild; requests, input/output tokens, estimated KRW; checks 0..100000 requests, 0..1e9 tokens, 0..1000000 KRW; cascade with the workspace); RLS on, one owner select policy for authenticated (private.app_is_workspace_owner); authenticated select only; service_role select + column insert/update, no delete; no monthly cap value stored (Edge constant in P3c); app_now_details gains nullable column topic (labor/politics/economy/society or null, check constraint, existing rows stay null, table grants unchanged); no anon/PUBLIC, no new function, no change to other columns, policies, grants or rows']);
commit;
