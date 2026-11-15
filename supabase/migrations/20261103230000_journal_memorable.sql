begin;
-- S49-12 JOURNAL-기억할통화텔레그램(요청함 11/03 10:06 명진 덧붙임): 업무일지 [하루] 주간보고 재료의 네 번째 묶음 '기억할 통화·텔레그램'.
--   app_journal_memorable      한 줄 = AI가 고른 '주간보고에 담을 만한' 통화·텔레그램 한 건. 근거(app_feed_items.id)·조직 이름·한 줄·고른 결과
--                              (suggested 제안 / kept 넣음 / dropped 뺌, 고쳐 넣은 글 final_line, 뺀 이유 drop_reason).
--   app_journal_memorable_runs 하루 1행 = 마지막으로 AI에 보낸 시각(약 1시간 갱신 판정, 같은 기록을 다시 보내지 않음).
-- 통화·텔레그램은 운영자 전용: 두 표 모두 owner 정책 위에 restrictive 정책으로 private.app_workspace_has_feature('calls'|'telegram')를 더 요구한다
--   (권한을 넓히지 않고 좁히기만). authenticated: 읽기·넣기(값 칸만)·고치기(고른 결과 칸만). 지우기 없음. anon·PUBLIC·service_role: 없음.
-- Edge(ai-assist)는 사용자 로그인(JWT)으로 이 표에 쓴다(journal-draft와 같은 길). 비밀값·원문 전체는 넣지 않는다(한 줄 160자).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경, 읽생기 표.
-- 짝: docs/20261103230000_journal_memorable.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103230000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_journal_memorable') is not null
     or to_regclass('public.app_journal_memorable_runs') is not null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'JOURNAL_MEMORABLE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_journal_memorable (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  source text not null,
  feed_item_id uuid not null references public.app_feed_items(id) on delete cascade,
  org_name text,
  line text not null,
  status text not null default 'suggested',
  final_line text,
  drop_reason text,
  picked_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_journal_memorable_source_check check (source in ('call','telegram')),
  constraint app_journal_memorable_line_check check (char_length(line) between 1 and 160),
  constraint app_journal_memorable_org_check check (org_name is null or char_length(org_name) between 1 and 60),
  constraint app_journal_memorable_status_check check (status in ('suggested','kept','dropped')),
  constraint app_journal_memorable_final_check check (final_line is null or char_length(final_line) between 1 and 160),
  constraint app_journal_memorable_reason_check check (drop_reason is null or drop_reason in ('중복','사적','주간보고감 아님','기타')),
  constraint app_journal_memorable_once unique (workspace_id, feed_item_id)
);
create index app_journal_memorable_day_idx on public.app_journal_memorable(workspace_id, day);

create table public.app_journal_memorable_runs (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  last_run_at timestamptz not null default now(),
  primary key (workspace_id, day)
);

alter table public.app_journal_memorable enable row level security;
alter table public.app_journal_memorable_runs enable row level security;
revoke all on table public.app_journal_memorable from public, anon, authenticated, service_role;
revoke all on table public.app_journal_memorable_runs from public, anon, authenticated, service_role;

grant select on table public.app_journal_memorable to authenticated;
grant insert (workspace_id, day, source, feed_item_id, org_name, line) on table public.app_journal_memorable to authenticated;
grant update (status, final_line, drop_reason, decided_at) on table public.app_journal_memorable to authenticated;
grant select on table public.app_journal_memorable_runs to authenticated;
grant insert (workspace_id, day, last_run_at) on table public.app_journal_memorable_runs to authenticated;
grant update (last_run_at) on table public.app_journal_memorable_runs to authenticated;

create policy journal_memorable_owner_all on public.app_journal_memorable for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy op_feature_all on public.app_journal_memorable as restrictive for all to authenticated
  using (private.app_workspace_has_feature(workspace_id, case source when 'call' then 'calls' else 'telegram' end))
  with check (private.app_workspace_has_feature(workspace_id, case source when 'call' then 'calls' else 'telegram' end));
create policy journal_memorable_runs_owner_all on public.app_journal_memorable_runs for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy op_feature_all on public.app_journal_memorable_runs as restrictive for all to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'calls') or private.app_workspace_has_feature(workspace_id, 'telegram'))
  with check (private.app_workspace_has_feature(workspace_id, 'calls') or private.app_workspace_has_feature(workspace_id, 'telegram'));

-- 사후 확인: 두 표 RLS 켜짐·정책 둘씩(owner 하나 + restrictive 하나), anon·PUBLIC·service_role 권한 없음, 지우기 없음,
-- 고치기는 정해진 칸만. 다르면 전체 취소.
do $$
declare t regclass; ok boolean := true;
begin
  foreach t in array array['public.app_journal_memorable'::regclass, 'public.app_journal_memorable_runs'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('service_role', t, 'select,insert,update,references')
       or not has_table_privilege('authenticated', t, 'select')
       or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
       or (select count(*) from pg_policy where polrelid = t) <> 2
       or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
       or (select count(*) from pg_policy where polrelid = t and not polpermissive) <> 1 then
      ok := false;
    end if;
  end loop;
  if not ok
     or has_column_privilege('authenticated', 'public.app_journal_memorable'::regclass, 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_journal_memorable'::regclass, 'status', 'insert')
     or not has_column_privilege('authenticated', 'public.app_journal_memorable'::regclass, 'status', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_memorable'::regclass, 'line', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_memorable'::regclass, 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_memorable_runs'::regclass, 'day', 'update')
     or not has_column_privilege('authenticated', 'public.app_journal_memorable_runs'::regclass, 'last_run_at', 'update') then
    raise exception 'JOURNAL_MEMORABLE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103230000', 'journal_memorable', array['S49-12 JOURNAL-기억할통화텔레그램: app_journal_memorable + app_journal_memorable_runs (owner RLS + restrictive operator feature policy, no anon/PUBLIC/service_role, no delete)']);
commit;
