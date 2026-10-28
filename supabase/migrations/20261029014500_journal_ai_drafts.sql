begin;
-- JOURNAL-오늘한줄초안 1/3 DB(요청함 10/29 01:28, 명진 '진행, 추천대로'): 업무일지 '오늘 한 줄'의 저녁 AI 초안을 '확정 전'으로 따로 둘 표.
-- 초안은 업무일지 행(app_notes kind=work)에 넣지 않는다 — 주간보고·원장 재료는 그 행만 읽으므로, 명진이 고쳐 [저장]해야(그때 kind=work 줄이 됨) 확정이다.
-- 바꾸는 것: 새 표 1개(app_journal_drafts, 하루 1행)뿐. 기존 표·정책·권한·함수·자료는 한 줄도 바꾸지 않는다.
--  - 행: 작업공간·날짜(하루 1행, 기본 키)·초안 한 줄(1~300자, 줄바꿈·제어 문자 없음 — 업무일지 한 줄 규칙과 같음)·만든 시각.
--  - 쓰는 곳: ai-assist kind=journal_draft(내 로그인 토큰, owner RLS)가 넣기만 한다. 화면은 읽기만, 고치지 않는다(고친 글은 업무일지 줄로 저장).
-- 권한: owner만(private.app_is_workspace_owner). authenticated: 읽기·넣기(칸 4개)·지우기. 고치기 없음. anon·PUBLIC·service_role 권한 없음.
-- 짝: docs/20261029014500_journal_ai_drafts.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029014500')
     or to_regclass('public.app_journal_drafts') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'JOURNAL_AI_DRAFTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_journal_drafts (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  journal_day date not null,
  draft_text text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, journal_day),
  constraint app_journal_drafts_text_check check (
    char_length(draft_text) between 1 and 300 and draft_text = btrim(draft_text) and draft_text !~ '[[:cntrl:]]')
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만(created_at은 서버 시각).
alter table public.app_journal_drafts enable row level security;
revoke all on table public.app_journal_drafts from public, anon, authenticated, service_role;
grant select, delete on table public.app_journal_drafts to authenticated;
grant insert (workspace_id, journal_day, draft_text) on table public.app_journal_drafts to authenticated;

create policy journal_drafts_owner_all on public.app_journal_drafts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음, 트리거 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_journal_drafts'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_journal_drafts'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_journal_drafts'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_journal_drafts', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_journal_drafts', 'update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_journal_drafts', 'update')
     or has_column_privilege('authenticated', 'public.app_journal_drafts', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_journal_drafts', 'draft_text', 'insert')
     or not has_table_privilege('authenticated', 'public.app_journal_drafts', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_journal_drafts'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_journal_drafts'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_journal_drafts'::regclass and not tgisinternal) then
    raise exception 'JOURNAL_AI_DRAFTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029014500', 'journal_ai_drafts', array['JOURNAL-오늘한줄초안: app_journal_drafts (owner RLS, one AI draft line per day, select/insert/delete for authenticated, no update)']);
commit;
