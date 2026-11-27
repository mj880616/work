begin;
-- S71-51 노트 보드 모든 칸 가지 뻗기(사용자 결정 2026-11-26 "텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면", "관계망 형성이 되어야해").
-- 앞 단계: 20261125040000_note_board_decor 기록이 있어야 한다. 설계: docs/design/note-board-mindmap.md 9절.
-- 바꾸는 것: 기존 표 app_note_board_texts(보드에만 있는 글 상자)에서
--  · 새 칸 parent_note: 그 상자의 부모가 노트 카드(사진 카드 포함)일 때 그 노트 id. 노트가 지워지면 비움(on delete set null — 상자는 혼자 선 칸으로 남음).
--    부모는 둘 중 하나만(parent_id 글 상자 · parent_note 노트 카드).
--  · 꾸미기 검사에서 '글자(label)·도형(shape)은 부모 없음' 줄만 뺀다(글자·도형도 가지가 됨). 나머지 범위는 그대로.
--  · 좁히기 정책 하나(restrictive): parent_note는 같은 작업공간 노트만(남의 노트 id를 적지 못함). 기존 owner 정책은 그대로.
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸은 비어 있음 = 지금 모양 그대로).
-- 권한: owner만(기존 정책 note_board_texts_owner_all 그대로 + 좁히기만). 새 칸 넣기·고치기 권한만 authenticated에 더한다.
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 적용 경로: 승인형 DB workflow 확장 규칙(기존 표의 새 칸 권한 · restrictive 정책).
--   짝: docs/20261126230000_note_board_branch_all.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126230000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040000' and name = 'note_board_decor')
     or to_regclass('public.app_note_board_texts') is null
     or to_regclass('public.app_notes') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname = 'parent_note' and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_decor_check' and contype = 'c')
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_parent_one_check')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')
         and polname = 'note_board_texts_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_BRANCH_ALL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_texts add column parent_note uuid references public.app_notes(id) on delete set null;
alter table public.app_note_board_texts add constraint app_note_board_texts_parent_one_check check (parent_id is null or parent_note is null);
alter table public.app_note_board_texts drop constraint app_note_board_texts_decor_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_decor_check check (
  z between -100000 and 100000
  and (stroke is null or stroke between -1 and 9)
  and (stroke_w is null or stroke_w between 1 and 8)
  and (alpha is null or alpha between 10 and 100)
  and (align is null or align in ('left', 'center', 'right'))
  and (ink is null or ink between 0 and 9));
create index app_note_board_texts_parent_note_idx on public.app_note_board_texts(parent_note);

create policy note_board_texts_parent_note_own on public.app_note_board_texts as restrictive for all to authenticated
  using (parent_note is null or exists (select 1 from public.app_notes n
    where n.id = app_note_board_texts.parent_note and n.workspace_id = app_note_board_texts.workspace_id))
  with check (parent_note is null or exists (select 1 from public.app_notes n
    where n.id = app_note_board_texts.parent_note and n.workspace_id = app_note_board_texts.workspace_id));

grant insert (parent_note) on table public.app_note_board_texts to authenticated;
grant update (parent_note) on table public.app_note_board_texts to authenticated;

-- 사후 확인: RLS 켜짐, 정책 2개(owner 그대로 + 좁히기, 모두 authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·보드 고치기 권한 없음, 트리거 없음. 다르면 전체 취소.
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
     or not has_column_privilege('authenticated', t, 'parent_note', 'insert')
     or not has_column_privilege('authenticated', t, 'parent_note', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 2
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and polpermissive) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_parent_note_own'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*' and not polpermissive) <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NOTE_BOARD_BRANCH_ALL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126230000', 'note_board_branch_all', array['S71-51: app_note_board_texts parent_note (card parent), labels and shapes may branch, restrictive same-workspace note policy']);
commit;
