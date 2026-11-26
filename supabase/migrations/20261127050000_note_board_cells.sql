begin;
-- S71-56 NOTE-보드 표·파일 칸(사용자 결정 2026-11-26 21:11 "텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면", "표도 넣을 수 있고 모든 것에서").
-- 앞 단계: 20261126230000_note_board_branch_all(모든 칸 가지) 기록이 있어야 한다.
-- 바꾸는 것(글 상자 표 app_note_board_texts 하나만):
--  1) 칸 종류 두 가지 더함: 표(kind 'table')·파일(kind 'file'). 둘 다 글(body)은 빈 글('')이다. 다른 종류의 글 규칙은 그대로.
--  2) 표 칸 글 칸 cells jsonb: 줄 1~30 × 칸 1~12 네모(모든 줄 칸 수 같음), 칸마다 글자(string)만, 전체 20,000바이트까지. 표가 아니면 비움.
--  3) 파일 칸이 가리키는 곳(셋 중 하나만): 자료실 자료 file_doc(app_documents, 자료를 지우면 칸도 함께),
--     또는 노트 첨부 file_note(app_notes, 노트를 지우면 칸도 함께) + file_drive(그 첨부의 드라이브 파일 번호, 영문·숫자·_·-만).
--     파일 원본은 드라이브 그대로이고 칸은 번호만 가진다(복사·이동 없음). 파일이 아니면 셋 다 비움.
--  4) 좁히기 정책 하나 note_board_texts_file_own(restrictive): 가리키는 자료·노트는 같은 작업공간 것만 보이고 쓰인다.
--     넣을 때는 그 노트에 실제로 그 첨부가 있어야 한다(노트 첨부 목록 attachments에 그 드라이브 번호). 기존 owner 정책은 그대로(넓히지 않음).
--  5) 새 칸 넣기 권한(cells·file_doc·file_note·file_drive)과 표 글 고치기 권한(cells)만 authenticated에. 파일이 가리키는 곳은 고치지 못한다(지우고 다시 넣음).
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸은 모두 비움 = 지금 모양 그대로). 색인·트리거·함수 없음. anon·PUBLIC·service_role 권한 없음.
-- 적용 경로: 승인형 DB workflow 확장 규칙(기존 표의 새 칸 권한 + 좁히기 정책 + 검사 교체). 짝: docs/20261127050000_note_board_cells.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127050000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261126230000' and name = 'note_board_branch_all')
     or to_regclass('public.app_note_board_texts') is null
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_documents') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname in ('cells', 'file_doc', 'file_note', 'file_drive') and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname = 'parent_note' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes')
         and attname = 'attachments' and atttypid = 'jsonb'::regtype and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_mindmap_check' and contype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_body_check' and contype = 'c')
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname in ('app_note_board_texts_cells_check', 'app_note_board_texts_file_check'))
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')) <> 2
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')
         and polname in ('note_board_texts_owner_all', 'note_board_texts_parent_note_own')) <> 2 then
    raise exception 'NOTE_BOARD_CELLS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;
do $$
begin
  if exists (select 1 from public.app_note_board_texts where kind not in ('topic', 'sticky', 'label', 'shape')) then
    raise exception 'NOTE_BOARD_CELLS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 새 칸
alter table public.app_note_board_texts add column cells jsonb;
alter table public.app_note_board_texts add column file_doc uuid references public.app_documents(id) on delete cascade;
alter table public.app_note_board_texts add column file_note uuid references public.app_notes(id) on delete cascade;
alter table public.app_note_board_texts add column file_drive text;
create index app_note_board_texts_file_doc_idx on public.app_note_board_texts(file_doc) where file_doc is not null;
create index app_note_board_texts_file_note_idx on public.app_note_board_texts(file_note) where file_note is not null;

-- 2) 종류 두 가지 더함(나머지 규칙은 20261125040000_note_board_decor 판 그대로)
alter table public.app_note_board_texts drop constraint app_note_board_texts_mindmap_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_mindmap_check check (
  (parent_id is null or parent_id <> id)
  and ord between 0 and 1000000
  and (side is null or side in (-1, 1))
  and kind in ('topic', 'sticky', 'label', 'shape', 'table', 'file')
  and (color is null or color between -1 and 9)
  and shape in ('round', 'rect', 'pill', 'plain', 'ellipse', 'diamond', 'triangle', 'arrow')
  and font between 1 and 4
  and (w is null or w between 60 and 600));
-- 표·파일 칸은 빈 글, 도형은 빈 글도 됨, 그 밖은 지금 글 규칙(1~300자, 줄바꿈만)
alter table public.app_note_board_texts drop constraint app_note_board_texts_body_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_body_check check (
  (kind in ('table', 'file') and body = '')
  or (kind = 'shape' and body = '')
  or (kind not in ('table', 'file')
    and char_length(body) between 1 and 300 and btrim(body, E' \n') <> '' and translate(body, E'\n', '') !~ '[[:cntrl:]]'));

-- 3) 표 글: 네모 모양 글자 표, 크기 상한. 앞 줄이 틀리면 뒤 줄을 보지 않게 case로 차례를 고정한다(검사 중 오류 없이 거절).
alter table public.app_note_board_texts add constraint app_note_board_texts_cells_check check (
  (kind = 'table') = (cells is not null)
  and (cells is null or coalesce(case
    when jsonb_typeof(cells) <> 'array' then false
    when jsonb_array_length(cells) not between 1 and 30 then false
    when jsonb_path_exists(cells, 'strict $[*] ? (@.type() != "array")') then false
    when jsonb_path_exists(cells, 'strict $[*][*] ? (@.type() != "string")') then false
    when jsonb_array_length(cells -> 0) not between 1 and 12 then false
    when jsonb_path_exists(cells, 'strict $[*] ? (@.size() != $n)', jsonb_build_object('n', jsonb_array_length(cells -> 0))) then false
    else octet_length(cells::text) <= 20000 end, false)));

-- 4) 파일이 가리키는 곳: 파일 칸만, 자료 또는 노트 첨부 하나
alter table public.app_note_board_texts add constraint app_note_board_texts_file_check check (
  ((kind = 'file' and num_nonnulls(file_doc, file_note) = 1) or (kind <> 'file' and file_doc is null and file_note is null))
  and ((file_note is null) = (file_drive is null))
  and (file_drive is null or file_drive ~ '^[A-Za-z0-9_-]{1,255}$'));

-- 5) 좁히기 정책: 같은 작업공간 자료·노트만. 넣을 때는 그 노트에 그 첨부가 있어야 한다.
create policy note_board_texts_file_own on public.app_note_board_texts as restrictive for all to authenticated
  using ((file_doc is null or exists (select 1 from public.app_documents d
      where d.id = app_note_board_texts.file_doc and d.workspace_id = app_note_board_texts.workspace_id))
    and (file_note is null or exists (select 1 from public.app_notes n
      where n.id = app_note_board_texts.file_note and n.workspace_id = app_note_board_texts.workspace_id)))
  with check ((file_doc is null or exists (select 1 from public.app_documents d
      where d.id = app_note_board_texts.file_doc and d.workspace_id = app_note_board_texts.workspace_id))
    and (file_note is null or exists (select 1 from public.app_notes n
      where n.id = app_note_board_texts.file_note and n.workspace_id = app_note_board_texts.workspace_id
        and n.attachments @> jsonb_build_array(jsonb_build_object('drive_file_id', app_note_board_texts.file_drive)))));

grant insert (cells, file_doc, file_note, file_drive) on table public.app_note_board_texts to authenticated;
grant update (cells) on table public.app_note_board_texts to authenticated;

-- 사후 확인: RLS 켜짐, 정책 셋(owner 하나 + 좁히기 둘, authenticated만), anon·PUBLIC·service_role 권한 없음,
-- 작업공간·보드·파일이 가리키는 곳은 못 고침, 트리거 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_note_board_texts'::regclass;
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
     or has_column_privilege('authenticated', t, 'id', 'update')
     or has_column_privilege('authenticated', t, 'created_at', 'insert')
     or has_column_privilege('authenticated', t, 'file_doc', 'update')
     or has_column_privilege('authenticated', t, 'file_note', 'update')
     or has_column_privilege('authenticated', t, 'file_drive', 'update')
     or not has_column_privilege('authenticated', t, 'cells', 'insert')
     or not has_column_privilege('authenticated', t, 'cells', 'update')
     or not has_column_privilege('authenticated', t, 'file_doc', 'insert')
     or not has_column_privilege('authenticated', t, 'file_note', 'insert')
     or not has_column_privilege('authenticated', t, 'file_drive', 'insert')
     or (select count(*) from pg_policy where polrelid = t) <> 3
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and polpermissive) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_parent_note_own'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and not polpermissive) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_file_own'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and not polpermissive) <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0
     or exists (select 1 from public.app_note_board_texts where kind in ('table', 'file')) then
    raise exception 'NOTE_BOARD_CELLS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127050000', 'note_board_cells', array['S71-56: app_note_board_texts table and file kinds, cells (rectangular text table), file_doc (library document) or file_note + file_drive (note attachment), restrictive same-workspace document and note policy']);
commit;
