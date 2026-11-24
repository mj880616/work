begin;
-- S69-94 NOTE-메모통일(명진 11/25 03:14~03:17 "노트 생각 질문 인용이 댓글이지? 읽을 거리 저장한 글에도 똑같이 댓글 시스템으로 / 걍 다 메모로 통일 /
-- 남기는 형식은 댓글인데 부르는 명칭은 메모 남기기 / 메모를 모아두는 화면에서는 ... 그 메모를 남긴 원문 기록으로 연결도 되어야").
-- 바꾸는 것: 새 표 1개(app_memos) + 옛 노트 댓글(app_note_comments) 줄을 새 표로 복사. 기존 표·정책·권한·자료는 한 줄도 바꾸거나 지우지 않는다
--   (옛 댓글 표는 그대로 남는다 — 화면은 새 표만 읽고, 옛 표 정리는 따로 정한다).
--  - 메모 한 줄 = 작업공간 + 대상 종류(target_type) + 대상 id(target_id) + 글(body, 1~4000자) + 시각. 원문 제목 사본(target_title, 300자까지)을 함께 남겨
--    원문이 지워져도 무엇에 단 메모인지 보이게 한다. 대상에 외래 키를 걸지 않는다(원문을 지워도 메모는 남고 화면이 '원래 기록이 없어요'로 링크만 끈다).
--  - 대상 종류: note(노트) · news·outside(읽을 거리 기사·성명, 공용 글 id) · reading(저장한 글 app_reading_items) · brief(브리핑 룸 자료 — 화면은 다음 단계).
--    다음 단계(S69-95: 자료실 파일·회의 기록·담당조직 기록·텔레그램 소식)는 이 검사(app_memos_target_type_check) 한 줄만 바꿔 같은 표를 쓴다.
--  - quote·kind는 옛 댓글의 인용 글·종류(생각·질문·인용)를 잃지 않게 보존하는 칸이다. 화면은 종류를 쓰지 않는다.
-- 권한: owner만(private.app_is_workspace_owner). 노트에 다는 메모는 넣을 때 같은 작업공간의 노트(kind=note)여야 한다.
--   authenticated: 읽기·지우기, 넣기는 필요한 칸만, 고치기는 글(body)·고친 시각(updated_at)만. anon·PUBLIC·service_role 권한 없음.
-- 짝: docs/20261125020000_memos.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125020000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102203000' and name = 'note_comments') <> 1
     or to_regclass('public.app_memos') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_note_comments') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_notes'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'workspace_id', 'kind', 'title')) <> 4
     or (select count(*) from pg_attribute where attrelid = 'public.app_note_comments'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'workspace_id', 'note_id', 'kind', 'quote', 'body', 'created_at')) <> 7
     or not exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.app_note_comments'::regclass and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'MEMOS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  target_title text,
  body text not null,
  quote text,
  kind text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_memos_target_type_check check (target_type in ('note', 'news', 'outside', 'reading', 'brief')),
  constraint app_memos_target_title_check check (
    target_title is null or (char_length(target_title) between 1 and 300 and btrim(target_title) <> '')),
  constraint app_memos_body_check check (
    char_length(body) between 1 and 4000 and btrim(body) <> ''),
  constraint app_memos_quote_check check (
    quote is null or (char_length(quote) between 1 and 1000 and btrim(quote) <> '')),
  constraint app_memos_kind_check check (
    kind is null or (char_length(kind) between 1 and 20 and kind = btrim(kind) and kind !~ '[[:cntrl:]]'))
);
create index app_memos_scope_idx on public.app_memos(workspace_id, created_at desc);
create index app_memos_target_idx on public.app_memos(target_type, target_id, created_at);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
alter table public.app_memos enable row level security;
revoke all on table public.app_memos from public, anon, authenticated, service_role;
grant select, delete on table public.app_memos to authenticated;
grant insert (workspace_id, target_type, target_id, target_title, body, quote, kind) on table public.app_memos to authenticated;
grant update (body, updated_at) on table public.app_memos to authenticated;

create policy memos_owner_select on public.app_memos for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy memos_owner_insert on public.app_memos for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (target_type <> 'note' or exists (
      select 1 from public.app_notes n
      where n.id = target_id and n.workspace_id = app_memos.workspace_id and n.kind = 'note')));
-- 고치기: 원문이 지워진 뒤에도 그 메모 글은 고칠 수 있다(대상·작업공간 칸은 고치기 권한이 없다).
create policy memos_owner_update on public.app_memos for update to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy memos_owner_delete on public.app_memos for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 옛 노트 댓글을 새 표로 복사(같은 id·작업공간·노트·글·인용·종류·쓴 시각, 원문 제목 사본은 지금 노트 제목 한 줄 300자). 옛 표의 줄은 그대로 둔다.
insert into public.app_memos (id, workspace_id, target_type, target_id, target_title, body, quote, kind, created_at, updated_at)
select c.id, c.workspace_id, 'note', c.note_id,
       nullif(btrim(left(btrim(regexp_replace(coalesce(n.title, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 300)), ''),
       c.body, c.quote, c.kind, c.created_at, c.created_at
  from public.app_note_comments c
  left join public.app_notes n on n.id = c.note_id;

-- 사후 확인: RLS 켜짐, 정책 4개(authenticated만), anon·PUBLIC·service_role 권한 없음, 고치기는 글·시각만, 옛 댓글이 모두 옮겨짐. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_memos'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_memos'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_memos'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_memos', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_memos', 'update,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_memos', 'target_type', 'update')
     or has_column_privilege('authenticated', 'public.app_memos', 'target_id', 'update')
     or has_column_privilege('authenticated', 'public.app_memos', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_memos', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_memos', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_memos', 'body', 'update')
     or not has_column_privilege('authenticated', 'public.app_memos', 'body', 'insert')
     or not has_table_privilege('authenticated', 'public.app_memos', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass) <> 4
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 4
     or (select count(*) from public.app_memos) <> (select count(*) from public.app_note_comments)
     or exists (select 1 from public.app_note_comments c
         where not exists (select 1 from public.app_memos m where m.id = c.id and m.target_type = 'note' and m.target_id = c.note_id
           and m.workspace_id = c.workspace_id and m.body = c.body)) then
    raise exception 'MEMOS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125020000', 'memos', array['NOTE-메모통일: app_memos (target type+id, owner RLS 4 policies, note in same workspace on insert, update body only), copy app_note_comments rows (old table kept)']);
commit;
