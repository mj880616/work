begin;
-- S55-07 HOME-하루채우기 PR-B(명진 11/09 09:43 시안 ④ 승인 "하루 시안은 좋아"): 홈 [하루]의 ② '읽을 만한 글'(최대 3개)과
-- ③ '이런 기록은 어때요?'(1~2개, 저녁 6시부터)를 서버가 골라 두는 곳. 아침 한 번·저녁 한 번(새 뉴스가 없으면 다시 고르지 않음)을
-- 지키려면 고른 결과와 고른 때를 서버에 남겨야 하는데 같은 일을 하는 표가 없어(기억할 소식 표는 통화·텔레그램 줄 전용) 작은 표를 더한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
--   app_home_day_picks  작업공간·날짜 한 줄. reads(읽을 글 jsonb 배열 0~3)·reads_at·reads_slot(am|pm)·news_seen_at(그때 본 가장 새 뉴스 시각)
--     · suggests(기록 제안 jsonb 배열 0~2)·suggests_at·suggests_done(일기를 쓴 제안 id, s1~s9)·run_at(두 기기 동시 고르기 막는 차지 시각).
-- 권한: owner 정책 하나(authenticated만, private.app_is_workspace_owner). 운영자 기능 표시 없음(뉴스·일정·할 일은 모든 사용자 기능, 통화 재료는
--   ai-assist가 서버 허용 표로 따로 거름). authenticated: 읽기·넣기(workspace_id·day만)·고치기(값 칸만). 지우기 없음. anon·PUBLIC·service_role: 없음.
--   ai-assist가 사용자 로그인(JWT)으로 넣고 고친다. 화면은 읽기와 suggests_done 고치기(다음 PR-C)만 한다.
-- 안 하는 것: 기존 표·칸·검사·정책·권한·트리거·함수·색인 변경, 기존 줄 변경, rtw_* 객체.
-- 짝: docs/20261109180000_home_day_picks.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109180000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_home_day_picks') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'HOME_DAY_PICKS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_home_day_picks (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  reads jsonb not null default '[]'::jsonb,
  reads_at timestamptz,
  reads_slot text,
  news_seen_at timestamptz,
  suggests jsonb not null default '[]'::jsonb,
  suggests_at timestamptz,
  suggests_done text[] not null default '{}'::text[],
  run_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_home_day_picks_pkey primary key (workspace_id, day),
  constraint app_home_day_picks_reads_check check (
    jsonb_typeof(reads) = 'array' and jsonb_array_length(reads) <= 3 and octet_length(reads::text) <= 12000),
  constraint app_home_day_picks_suggests_check check (
    jsonb_typeof(suggests) = 'array' and jsonb_array_length(suggests) <= 2 and octet_length(suggests::text) <= 3000),
  constraint app_home_day_picks_slot_check check (reads_slot is null or reads_slot in ('am', 'pm')),
  constraint app_home_day_picks_done_check check (
    cardinality(suggests_done) <= 10 and array_position(suggests_done, null) is null
    and array_to_string(suggests_done, ',') ~ '^(s[1-9](,|$))*$'
    and char_length(array_to_string(suggests_done, ',')) = greatest(cardinality(suggests_done) * 3 - 1, 0))
);

alter table public.app_home_day_picks enable row level security;
revoke all on table public.app_home_day_picks from public, anon, authenticated, service_role;

grant select on table public.app_home_day_picks to authenticated;
grant insert (workspace_id, day) on table public.app_home_day_picks to authenticated;
grant update (reads, reads_at, reads_slot, news_seen_at, suggests, suggests_at, suggests_done, run_at) on table public.app_home_day_picks to authenticated;

create policy home_day_picks_owner_all on public.app_home_day_picks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐·정책 하나(authenticated), anon·PUBLIC·service_role 권한 없음, 지우기 없음, 넣기·고치기는 정해진 칸만, 빈 표. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_home_day_picks'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('authenticated', t, 'workspace_id', 'insert')
     or has_column_privilege('authenticated', t, 'reads', 'insert')
     or has_column_privilege('authenticated', t, 'created_at', 'insert,update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'day', 'update')
     or not has_column_privilege('authenticated', t, 'reads', 'update')
     or not has_column_privilege('authenticated', t, 'suggests_done', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or exists (select 1 from pg_policy where polrelid = t and not polpermissive)
     or exists (select 1 from public.app_home_day_picks) then
    raise exception 'HOME_DAY_PICKS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109180000', 'home_day_picks', array['HOME day fill: app_home_day_picks (one row per workspace and day: reads jsonb 0-3, reads_at, reads_slot am|pm, news_seen_at, suggests jsonb 0-2, suggests_at, suggests_done s1-s9, run_at claim), owner RLS, authenticated select/insert(workspace_id,day)/update(value columns), no delete, no anon/PUBLIC/service_role; no change to existing tables']);
commit;
