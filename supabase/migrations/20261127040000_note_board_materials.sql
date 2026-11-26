begin;
-- S71-54 NOTE-주제재료잇기(사용자 결정 2026-11-26 19:58~59).
-- 앞 단계: 20261127020000_note_board_relation 기록이 있어야 한다(선 종류 칸 kind). 설계: docs/design/note-board-mindmap.md 13절.
-- 새 표를 만들지 않는다. 보드 위 칸끼리 잇는 기존 표 app_note_board_links(연결선·관계선)에 '재료' 종류 하나를 더한다.
--  · kind = 'material'(재료): 끝 하나는 늘 그 보드의 주제 상자(from_text), 다른 끝은 새 칸 셋 중 하나 —
--    노트(mat_note → app_notes, 노트를 지우면 잇기도 지워짐), 자료실 자료(mat_doc → app_documents, 자료를 지우면 잇기도 지워짐),
--    웹 주소(mat_url, http:// · https:// 만 · 빈칸·제어 문자 없음 · 2000자까지).
--    노트 재료를 지금 선 끝 칸(to_note)에 두지 않는 까닭: '같은 두 끝은 한 줄' 색인(app_note_board_links_end_key)이 같은 주제 → 같은 노트의
--    선·관계선과 재료를 서로 막는다. 재료 칸을 따로 두면 기존 색인·정책은 그대로 두고(지우거나 바꾸지 않음) 선과 재료가 함께 있을 수 있다.
--  · 재료 이름은 지금 칸 label(1~40자, 비우면 화면이 노트·자료 이름이나 주소를 쓴다). 재료는 선으로 그리지 않는다(주제 아래 작은 칩).
--  · 같은 주제에 같은 재료는 한 번만(부분 unique 색인).
--  · 좁히기 정책 하나(restrictive): mat_note는 같은 작업공간 노트(kind 'note')만, mat_doc은 같은 작업공간 자료만(남의 id를 적지 못함). 기존 owner 정책은 그대로.
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸은 비어 있음, 지금 선·관계선 그대로).
-- 권한: owner만(기존 정책 note_board_links_owner_all 그대로 + 좁히기만). 새 칸 넣기 권한만 authenticated에 더한다(고치기 권한은 주지 않음 — 재료는 풀고 다시 잇는다).
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다. 새 함수·트리거·외부 호출 없음.
-- 적용 경로: 승인형 DB workflow 확장 규칙(기존 표의 새 칸 권한 · restrictive 정책).
--   짝: docs/20261127040000_note_board_materials.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127040000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261127020000' and name = 'note_board_relation')
     or to_regclass('public.app_note_board_links') is null
     or to_regclass('public.app_note_board_texts') is null
     or to_regclass('public.app_documents') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_links')
         and attname = 'kind' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_links')
         and attname in ('mat_note', 'mat_doc', 'mat_url') and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_kind_check' and contype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_end_one_check' and contype = 'c')
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname in ('app_note_board_links_material_check', 'app_note_board_links_url_check'))
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')
         and polname = 'note_board_links_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_MATERIALS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;
-- 기존 줄은 지금 선·관계선뿐이어야 한다(kind 칸이 있는 것을 위에서 확인한 뒤에 읽는다 — 없으면 위에서 이미 멈춤).
do $$
begin
  if exists (select 1 from public.app_note_board_links where kind not in ('line', 'relation')) then
    raise exception 'NOTE_BOARD_MATERIALS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_links add column mat_note uuid references public.app_notes(id) on delete cascade;
alter table public.app_note_board_links add column mat_doc uuid references public.app_documents(id) on delete cascade;
alter table public.app_note_board_links add column mat_url text;

alter table public.app_note_board_links drop constraint app_note_board_links_kind_check;
alter table public.app_note_board_links add constraint app_note_board_links_kind_check check (kind in ('line', 'relation', 'material'));
alter table public.app_note_board_links drop constraint app_note_board_links_end_one_check;
alter table public.app_note_board_links add constraint app_note_board_links_end_one_check
  check (num_nonnulls(from_note, from_text, from_x) = 1 and num_nonnulls(to_note, to_text, to_x, mat_note, mat_doc, mat_url) = 1);
-- 재료: 주제 상자에서 노트·자료·주소 하나로만. 재료가 아닌 선은 자료·주소 끝을 갖지 않는다.
alter table public.app_note_board_links add constraint app_note_board_links_material_check check (
  (kind <> 'material' and mat_note is null and mat_doc is null and mat_url is null)
  or (kind = 'material' and from_text is not null and to_note is null and to_text is null and to_x is null));
alter table public.app_note_board_links add constraint app_note_board_links_url_check check (
  mat_url is null or (char_length(mat_url) between 10 and 2000 and mat_url ~ '^https?://[^[:space:][:cntrl:]]+$'));

create unique index app_note_board_links_material_key on public.app_note_board_links
  (workspace_id, board_id, from_text, (coalesce(mat_note::text, mat_doc::text, mat_url))) where kind = 'material';
-- 노트·자료 쪽에서 '이어진 생각지도 주제'를 찾는 색인(재료 줄만).
create index app_note_board_links_material_note_idx on public.app_note_board_links(mat_note) where kind = 'material';
create index app_note_board_links_material_doc_idx on public.app_note_board_links(mat_doc) where kind = 'material';

create policy note_board_links_material_own on public.app_note_board_links as restrictive for all to authenticated
  using ((mat_note is null or exists (select 1 from public.app_notes n
      where n.id = app_note_board_links.mat_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'))
    and (mat_doc is null or exists (select 1 from public.app_documents d
      where d.id = app_note_board_links.mat_doc and d.workspace_id = app_note_board_links.workspace_id)))
  with check ((mat_note is null or exists (select 1 from public.app_notes n
      where n.id = app_note_board_links.mat_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'))
    and (mat_doc is null or exists (select 1 from public.app_documents d
      where d.id = app_note_board_links.mat_doc and d.workspace_id = app_note_board_links.workspace_id)));

grant insert (mat_note, mat_doc, mat_url) on table public.app_note_board_links to authenticated;

-- 사후 확인: RLS 켜짐, 정책 2개(owner 그대로 + 좁히기, 모두 authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·보드·새 칸 고치기 권한 없음, 트리거 없음,
-- 기존 행은 재료가 아님. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_note_board_links'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or not has_table_privilege('authenticated', t, 'select,delete')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'board_id', 'update')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or has_column_privilege('authenticated', t, 'created_at', 'insert')
     or not has_column_privilege('authenticated', t, 'mat_note', 'insert')
     or not has_column_privilege('authenticated', t, 'mat_doc', 'insert')
     or not has_column_privilege('authenticated', t, 'mat_url', 'insert')
     or has_column_privilege('authenticated', t, 'mat_note', 'update')
     or has_column_privilege('authenticated', t, 'mat_doc', 'update')
     or has_column_privilege('authenticated', t, 'mat_url', 'update')
     or has_column_privilege('authenticated', t, 'kind', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 2
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_links_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and polpermissive) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_links_material_own'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and not polpermissive) <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0
     or exists (select 1 from public.app_note_board_links where kind = 'material') then
    raise exception 'NOTE_BOARD_MATERIALS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127040000', 'note_board_materials', array['S71-54: app_note_board_links material kind (topic to note, library document or web address), mat_note, mat_doc and mat_url columns, restrictive same-workspace note and document policy']);
commit;
