begin;
-- JOURNAL-조직현황AI요약 (2026-10-22 사용자 요청 08:10 + 결정 11:11): 업무일지 [주간 정리] '4. 산하 조직 현황 > 1) 요약'의 조직별 AI 요약.
-- 새 표 1개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- app_weekly_org_summaries: 주(월요일)·조직마다 1행. 요약 글(주간보고 문체, 몇 줄)과 "고친 요약" 표시(edited)만 둔다. 원문은 옮기지 않는다.
--   - AI 요약은 서버 ai-assist(kind=org_summary)가 내 로그인으로 edited=false 행만 쓴다(고친 요약은 다시 만들어도 덮어쓰지 않음).
--   - 화면에서 고친 요약은 edited=true로 저장한다. 빈 글로 저장하면 행을 지운다(다음 [요약 만들기]에서 다시 생김).
-- owner만 읽고 쓴다(private.app_is_workspace_owner, 조직은 같은 작업공간만). anon·PUBLIC·service_role 권한과 공개 정책은 없다.
-- 정책·표 grant가 있어 승인형 DB workflow 검사가 거절하므로 SQL Editor(폰 경로 C) 전용. 짝: docs/20261022120000_weekly_org_summaries.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120000')
     or to_regclass('public.app_weekly_org_summaries') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'WEEKLY_ORG_SUMMARIES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- week_start: 그 주 월요일(한국 날짜). summary: 줄 1~8개를 \n 하나로 이은 글, 1~1,000자, 줄바꿈 말고 제어문자 없음, 빈 줄 없음.
create table public.app_weekly_org_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  summary text not null,
  edited boolean not null default false,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_weekly_org_summaries_week_check check (extract(isodow from week_start) = 1),
  constraint app_weekly_org_summaries_summary_check check (
    char_length(summary) between 1 and 1000
    and summary ~ '^[^\r\n]*[^[:space:]][^\r\n]*(\n[^\r\n]*[^[:space:]][^\r\n]*){0,7}$'
    and summary !~ '[\u0001-\u0009\u000b-\u001f\u007f]'),
  constraint app_weekly_org_summaries_one unique (workspace_id, week_start, organization_id)
);
create index app_weekly_org_summaries_org_idx on public.app_weekly_org_summaries(organization_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
-- authenticated: 읽기·지우기는 표 전체, 넣기는 필요한 칸만, 고치기는 글·표시·시각만(주·조직·작업공간은 못 바꿈).
alter table public.app_weekly_org_summaries enable row level security;
revoke all on table public.app_weekly_org_summaries from public, anon, authenticated, service_role;
grant select, delete on table public.app_weekly_org_summaries to authenticated;
grant insert (workspace_id, week_start, organization_id, summary, edited, generated_at, updated_at)
  on table public.app_weekly_org_summaries to authenticated;
grant update (summary, edited, generated_at, updated_at) on table public.app_weekly_org_summaries to authenticated;

create policy weekly_org_summaries_owner_all on public.app_weekly_org_summaries for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_weekly_org_summaries.workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_weekly_org_summaries'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_org_summaries'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_weekly_org_summaries'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_org_summaries'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_org_summaries'::regclass) <> 1 then
    raise exception 'WEEKLY_ORG_SUMMARIES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022120000', 'weekly_org_summaries', array['JOURNAL-조직현황AI요약: app_weekly_org_summaries (week x organization summary + edited flag), owner RLS, no anon/service_role']);
commit;
