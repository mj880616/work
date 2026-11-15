begin;
-- WEEKLY-내양식자유변형 ②(요청함 11/15 21:38–21:57, 명진 확정; 시안 docs/design/mockups/weekly-own-form.html #2664 ②):
-- 내가 올린 주간 보고 한글 파일에서 규칙으로 읽은 '내 양식'(항목 순서·이름·표 머리 칸·칸마다 채울 기록)을 서버에 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 바꾸는 것: 새 표 1개와 그 표의 트리거 함수 1개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
--  app_weekly_forms: 작업공간마다 '내 양식' 하나(workspace_id 유일).
--   name: 양식 이름(1~80자 한 줄). source_name: 올린 파일 이름(없으면 빈 양식에서 직접 만든 것). source_file_id: 올린 원본을 자료실에 둔 경우 그 파일 번호(④에서 씀).
--   form: {"v":1,"sections":[{"id","title","level","columns":[칸 이름],"fill":채울 기록}]} — 모양 검사는 화면 모델(app/weekly-own-form-model.mjs),
--         DB는 큰 틀(객체·판 1·항목 배열 40개까지·크기 30000바이트까지)만 막는다. 기록 내용은 넣지 않는다(양식 글자만).
--  트리거: updated_at은 서버 시각(동시 고침 판정 PATCH ...&updated_at=eq.<읽은 값>).
-- 권한: owner만(private.app_is_workspace_owner) 읽기·넣기·고치기·지우기(지우면 다시 백지). anon·PUBLIC·service_role 권한 없음.
--   workspace_id는 만든 뒤 고칠 수 없다. SECURITY DEFINER 없음. 같은 노조명+부서명끼리 나눠 쓰기는 COLLAB 구현 뒤 따로(지금은 내 것만).
-- 짝: docs/20261116003000_weekly_own_forms.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116003000')
     or to_regclass('public.app_weekly_forms') is not null
     or to_regprocedure('private.app_weekly_forms_stamp()') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'WEEKLY_FORMS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_weekly_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  source_name text,
  source_file_id text,
  form jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_weekly_forms_workspace_key unique (workspace_id),
  constraint app_weekly_forms_name_check check (
    char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_weekly_forms_source_name_check check (
    source_name is null or (char_length(source_name) between 1 and 200 and source_name !~ '[[:cntrl:]]')),
  constraint app_weekly_forms_source_file_check check (
    source_file_id is null or source_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint app_weekly_forms_form_check check (
    jsonb_typeof(form) = 'object' and form -> 'v' = '1'::jsonb
    and jsonb_typeof(form -> 'sections') = 'array' and jsonb_array_length(form -> 'sections') <= 40
    and octet_length(form::text) <= 30000)
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_weekly_forms enable row level security;
revoke all on table public.app_weekly_forms from public, anon, authenticated, service_role;
grant select, delete on table public.app_weekly_forms to authenticated;
grant insert (workspace_id, name, source_name, source_file_id, form) on table public.app_weekly_forms to authenticated;
grant update (name, source_name, source_file_id, form) on table public.app_weekly_forms to authenticated;

create policy weekly_forms_owner_all on public.app_weekly_forms for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- updated_at은 매 쓰기마다 서버 시각.
create function private.app_weekly_forms_stamp()
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
revoke all on function private.app_weekly_forms_stamp() from public, anon, authenticated, service_role;

create trigger app_weekly_forms_stamp
before insert or update on public.app_weekly_forms
for each row execute function private.app_weekly_forms_stamp();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음,
-- workspace_id·updated_at 고칠 수 없음, id 지정 넣기 없음, 트리거 1개. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_weekly_forms'::regclass;
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
     or has_column_privilege('authenticated', t, 'updated_at', 'insert')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'updated_at', 'update')
     or has_column_privilege('authenticated', t, 'created_at', 'update')
     or not has_column_privilege('authenticated', t, 'form', 'insert')
     or not has_column_privilege('authenticated', t, 'form', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 1
     or (select count(*) from public.app_weekly_forms) <> 0 then
    raise exception 'WEEKLY_FORMS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116003000', 'weekly_own_forms', array['WEEKLY-내양식자유변형 ②: app_weekly_forms (one form per workspace, owner RLS read/insert/update/delete named columns, server updated_at)']);
commit;
