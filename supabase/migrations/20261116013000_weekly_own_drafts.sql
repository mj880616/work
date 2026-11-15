begin;
-- WEEKLY-내양식자유변형 ④-2(요청함 11/15 21:56 구현 ④, 시안 docs/design/mockups/weekly-own-form.html ③): '내 양식'으로 만든 그 주 초안의
-- 칸 글(사람이 수정한 것 포함)을 주마다 서버에 둔다. 기존 주간 보고 임시저장(app_weekly_exec_requests.draft)과 섞지 않는다
-- (그 칸이 있으면 바탕 있는 화면으로 열리므로 — 내 양식 초안은 따로).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 바꾸는 것: 새 표 1개와 그 표의 트리거 함수 1개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
--  app_weekly_own_drafts: 작업공간 × 주(월요일) 하나. sections: [{"id","lines":[글]|null,"rows":[[칸 글]]|null}] (항목 id는 내 양식 항목 id).
--   DB는 큰 틀(배열·200개·200000바이트)만 막고 세부 모양은 화면 모델(app/weekly-own-draft-model.mjs)이 맞춘다.
--  트리거: updated_at은 서버 시각(동시 고침 판정 PATCH ...&updated_at=eq.<읽은 값>).
-- 권한: owner만(private.app_is_workspace_owner) 읽기·넣기·고치기(정한 칸)·지우기. anon·PUBLIC·service_role 권한 없음.
--   workspace_id·week_start는 만든 뒤 고칠 수 없다. SECURITY DEFINER 없음.
-- 짝: docs/20261116013000_weekly_own_drafts.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116013000')
     or to_regclass('public.app_weekly_own_drafts') is not null
     or to_regprocedure('private.app_weekly_own_drafts_stamp()') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'WEEKLY_OWN_DRAFTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_weekly_own_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_weekly_own_drafts_week_key unique (workspace_id, week_start),
  constraint app_weekly_own_drafts_week_check check (extract(isodow from week_start) = 1),
  constraint app_weekly_own_drafts_sections_check check (coalesce(
    jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 200
    and octet_length(sections::text) <= 200000, false))
);

alter table public.app_weekly_own_drafts enable row level security;
revoke all on table public.app_weekly_own_drafts from public, anon, authenticated, service_role;
grant select, delete on table public.app_weekly_own_drafts to authenticated;
grant insert (workspace_id, week_start, sections) on table public.app_weekly_own_drafts to authenticated;
grant update (sections) on table public.app_weekly_own_drafts to authenticated;

create policy weekly_own_drafts_owner_all on public.app_weekly_own_drafts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

create function private.app_weekly_own_drafts_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $stamp$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$stamp$;
revoke all on function private.app_weekly_own_drafts_stamp() from public, anon, authenticated, service_role;

create trigger app_weekly_own_drafts_stamp
before insert or update on public.app_weekly_own_drafts
for each row execute function private.app_weekly_own_drafts_stamp();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음,
-- workspace_id·week_start·updated_at 고칠 수 없음, id 지정 넣기 없음, 트리거 1개. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_weekly_own_drafts'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or not has_table_privilege('authenticated', t, 'select,delete')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'week_start', 'update')
     or has_column_privilege('authenticated', t, 'updated_at', 'update')
     or has_column_privilege('authenticated', t, 'created_at', 'update')
     or not has_column_privilege('authenticated', t, 'sections', 'insert')
     or not has_column_privilege('authenticated', t, 'sections', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 1
     or (select count(*) from public.app_weekly_own_drafts) <> 0 then
    raise exception 'WEEKLY_OWN_DRAFTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116013000', 'weekly_own_drafts', array['WEEKLY-내양식자유변형 ④-2: app_weekly_own_drafts (one row per workspace and Monday, owner RLS read/insert/update sections/delete, server updated_at)']);
commit;
