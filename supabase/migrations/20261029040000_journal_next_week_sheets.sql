begin;
-- JOURNAL-다음주준비 1/3 DB(설계 docs/design/next-week-sheet.md 5절, 명진 결정: 진행·금요일 15시·추천안): 업무일지 [주간 정리] 맨 위 [다음 주] 칸에 보일 '다음 주 준비 한 장'을 담는 표.
-- 바꾸는 것: 새 표 1개(app_journal_next_week_sheets, 주마다 1행)뿐. 기존 표·정책·권한·함수·자료는 한 줄도 바꾸지 않는다.
--  - 행: 작업공간·다음 주 월요일(주마다 1행, 기본 키)·핵심 세 가지(jsonb 배열)·①~⑥ 묶음 줄(jsonb 배열)·AI 결과·만든 방식·시각.
--  - 쓰는 곳: ai-assist kind=next_week_sheet(내 로그인 토큰, owner RLS)만 넣고 고친다(같은 주 [다시 만들기]는 덮어씀). 화면은 읽기만 한다.
--  - Web2는 단독 소유자라 user_id 칸 없이 작업공간으로만 가른다(오늘 한 줄 초안 app_journal_drafts와 같은 모양).
-- 권한: owner만(private.app_is_workspace_owner). authenticated: 읽기, 넣기(칸 6개), 고치기(칸 5개). 지우기 없음(지난 장은 기록으로 남김).
--  anon·PUBLIC·service_role 권한 없음.
-- 짝: docs/20261029040000_journal_next_week_sheets.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029040000')
     or to_regclass('public.app_journal_next_week_sheets') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'JOURNAL_NEXT_WEEK_SHEETS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_journal_next_week_sheets (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  top_lines jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  ai_status text not null,
  made_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, week_start),
  constraint app_journal_next_week_sheets_week_check check (extract(isodow from week_start) = 1),
  constraint app_journal_next_week_sheets_top_check check (
    jsonb_typeof(top_lines) = 'array' and jsonb_array_length(top_lines) <= 3),
  constraint app_journal_next_week_sheets_groups_check check (
    jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) <= 200 and pg_column_size(groups) <= 65536),
  constraint app_journal_next_week_sheets_ai_check check (ai_status in ('ok', 'limit', 'failed', 'skipped')),
  constraint app_journal_next_week_sheets_made_check check (made_by in ('auto', 'user'))
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기, 넣기·고치기는 필요한 칸만(created_at은 서버 시각, 키 칸은 고치지 못함).
alter table public.app_journal_next_week_sheets enable row level security;
revoke all on table public.app_journal_next_week_sheets from public, anon, authenticated, service_role;
grant select on table public.app_journal_next_week_sheets to authenticated;
grant insert (workspace_id, week_start, top_lines, groups, ai_status, made_by) on table public.app_journal_next_week_sheets to authenticated;
grant update (top_lines, groups, ai_status, made_by, updated_at) on table public.app_journal_next_week_sheets to authenticated;

create policy journal_next_week_sheets_owner_all on public.app_journal_next_week_sheets for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 지우기·키 고치기 권한 없음, 트리거 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_journal_next_week_sheets'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_journal_next_week_sheets'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_journal_next_week_sheets'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_journal_next_week_sheets', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_journal_next_week_sheets', 'delete,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'week_start', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'created_at', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'groups', 'insert')
     or not has_column_privilege('authenticated', 'public.app_journal_next_week_sheets', 'groups', 'update')
     or not has_table_privilege('authenticated', 'public.app_journal_next_week_sheets', 'select')
     or (select count(*) from pg_policy where polrelid = 'public.app_journal_next_week_sheets'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_journal_next_week_sheets'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_journal_next_week_sheets'::regclass and not tgisinternal) then
    raise exception 'JOURNAL_NEXT_WEEK_SHEETS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029040000', 'journal_next_week_sheets', array['JOURNAL-다음주준비: app_journal_next_week_sheets (owner RLS, one next-week sheet per week, select/insert/update for authenticated, no delete)']);
commit;
