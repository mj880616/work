begin;
-- NOTE-읽생기아이디어 1단계 DB(요청 2026-10-28 01:08 주소 이전 ③, 빠짐25): 노트 아래 댓글.
-- 바꾸는 것: 새 표 1개(app_note_comments)뿐. 기존 표·정책·권한·자료(app_notes 포함)는 한 줄도 바꾸지 않는다.
--  - 댓글 한 줄 = 노트 하나에 딸린 글(1~4000자) + 유형(kind, 화면 기본값 thought 생각·question 질문·quote 인용) + 인용 문장(quote, 인용일 때 본문에서 고른 문장).
--  - kind는 글자(1~20자)로 둔다: 다음 단계(유형 더하기·이름 바꾸기)에서 표를 다시 바꾸지 않게. 지금 화면은 세 가지만 쓴다.
--  - 해시태그는 표를 만들지 않는다: 노트 본문(app_notes.raw_text, 이미 서버 저장)의 #낱말을 화면이 읽어 모은다(같은 자료를 두 번 저장하지 않음).
--  - 노트를 영구 삭제하면 댓글도 함께 지워진다(on delete cascade). 휴지통에 있는 동안은 남는다(되돌리면 그대로).
-- 권한: owner만(private.app_is_workspace_owner). 넣을 때 그 노트가 같은 작업공간의 노트(kind=note)여야 한다.
--   authenticated: 읽기·지우기, 넣기는 필요한 칸만. 고치기 없음(지우고 다시 씀). anon·PUBLIC·service_role 권한 없음.
-- 짝: docs/20261102203000_note_comments.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102203000')
     or to_regclass('public.app_note_comments') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'kind'
         and atttypid = 'text'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_COMMENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_note_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  note_id uuid not null references public.app_notes(id) on delete cascade,
  kind text not null default 'thought',
  quote text,
  body text not null,
  created_at timestamptz not null default now(),
  constraint app_note_comments_kind_check check (
    char_length(kind) between 1 and 20 and kind = btrim(kind) and kind !~ '[[:cntrl:]]'),
  constraint app_note_comments_quote_check check (
    quote is null or (char_length(quote) between 1 and 1000 and btrim(quote) <> '')),
  constraint app_note_comments_body_check check (
    char_length(body) between 1 and 4000 and btrim(body) <> '')
);
create index app_note_comments_scope_idx on public.app_note_comments(workspace_id, created_at desc);
create index app_note_comments_note_idx on public.app_note_comments(note_id, created_at);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만(id·created_at은 서버가 정함).
alter table public.app_note_comments enable row level security;
revoke all on table public.app_note_comments from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_comments to authenticated;
grant insert (workspace_id, note_id, kind, quote, body) on table public.app_note_comments to authenticated;

-- 댓글의 노트는 같은 작업공간의 노트(kind=note)여야 한다. 노트 읽기는 그 표의 owner 정책을 그대로 따른다.
create policy note_comments_owner_all on public.app_note_comments for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_notes n
      where n.id = note_id and n.workspace_id = app_note_comments.workspace_id and n.kind = 'note'));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_note_comments'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_note_comments'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_note_comments'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_note_comments', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_note_comments', 'update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_note_comments', 'update')
     or has_column_privilege('authenticated', 'public.app_note_comments', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_note_comments', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_comments', 'body', 'insert')
     or not has_table_privilege('authenticated', 'public.app_note_comments', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_note_comments'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_note_comments'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from public.app_note_comments) <> 0 then
    raise exception 'NOTE_COMMENTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102203000', 'note_comments', array['NOTE-읽생기아이디어: app_note_comments (owner RLS, note in same workspace, insert/select/delete only)']);
commit;
