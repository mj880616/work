begin;
-- S69-97 NOTE-서식 DB: 노트 '서식'(회의록 같은 틀을 저장해 두고 새 노트를 만들 때 고름)을 담는 새 표 1개(app_note_templates).
-- 바꾸는 것: 새 표 1개뿐. 기존 표·정책·권한·자료(app_notes 포함)는 한 줄도 바꾸지 않는다.
--  - 서식 한 줄 = 작업공간 하나의 이름(name 1~40자, 앞뒤 빈칸만·제어문자 불가, 작업공간 안에서 이름 하나에 한 줄)과 서식 본문(doc).
--  - doc은 노트 본문(app_notes.doc, 20261023233000 app_notes_doc_check)과 같은 ed1 모양: {"v":"ed1","doc":{"type":...,"content":[...]}}.
--    크기 상한은 200000바이트로 노트(1048576)보다 좁다(노트 검사보다 넓히지 않음).
--  - 작업공간을 지우면 서식도 함께 지워진다(on delete cascade).
-- 권한: owner만(private.app_is_workspace_owner). authenticated: 읽기·지우기, 넣기는 작업공간·이름·본문만(id·시각은 서버가 정함),
--   고치기는 이름·본문·updated_at만(작업공간은 못 고침). anon·PUBLIC·service_role 권한 없음. 함수·트리거 없음.
--   공유(COLLAB) 함수는 이 표를 읽지 않는다(넓히지 않음).
-- 짝: docs/20261125131000_note_templates.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125131000')
     or to_regclass('public.app_note_templates') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_workspaces') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_TEMPLATES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_note_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_note_templates_name_check check (
    char_length(name) between 1 and 40 and btrim(name) <> '' and name !~ '[[:cntrl:]]'),
  constraint app_note_templates_doc_check check (
    coalesce(
      jsonb_typeof(doc) = 'object'
      and doc ->> 'v' = 'ed1'
      and jsonb_typeof(doc -> 'doc') = 'object'
      and jsonb_typeof(doc -> 'doc' -> 'content') = 'array'
      and octet_length(doc::text) <= 200000, false)),
  constraint app_note_templates_name_key unique (workspace_id, name)
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_note_templates enable row level security;
revoke all on table public.app_note_templates from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_templates to authenticated;
grant insert (workspace_id, name, doc) on table public.app_note_templates to authenticated;
grant update (name, doc, updated_at) on table public.app_note_templates to authenticated;

create policy note_templates_owner_all on public.app_note_templates for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), 트리거 없음, anon·PUBLIC·service_role 권한 없음,
-- id·시각 넣기 불가, 작업공간·id·created_at 고치기 불가. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_note_templates'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_note_templates'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_note_templates'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_note_templates', 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', 'public.app_note_templates', 'select,insert,update,references')
     or has_table_privilege('service_role', 'public.app_note_templates', 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', 'public.app_note_templates', 'select,insert,update,references')
     or has_table_privilege('authenticated', 'public.app_note_templates', 'insert,update,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'updated_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_templates', 'created_at', 'update')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'workspace_id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'name', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'doc', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'name', 'update')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'doc', 'update')
     or not has_column_privilege('authenticated', 'public.app_note_templates', 'updated_at', 'update')
     or not has_table_privilege('authenticated', 'public.app_note_templates', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_note_templates'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_note_templates'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_note_templates'::regclass and not tgisinternal) <> 0
     or (select count(*) from public.app_note_templates) <> 0 then
    raise exception 'NOTE_TEMPLATES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125131000', 'note_templates', array['S69-97 NOTE templates: app_note_templates (owner RLS, name 1-40 unique per workspace, ed1 doc up to 200000 bytes, select/delete, insert and update named columns)']);
commit;
