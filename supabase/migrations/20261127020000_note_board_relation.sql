begin;
-- S71-53 NOTE-관계선(사용자 결정 2026-11-26 19:58 "굉장히 광범위한 생각지도 … 서로의 관계성을 잇고", 21:10~21:11 "관계망 형성이 되어야해").
-- 앞 단계: 20261125040100_note_board_free_lines 기록이 있어야 한다(선 점 끝·색·두께 칸). 설계: docs/design/note-board-mindmap.md 12절.
-- 바꾸는 것: 기존 표 app_note_board_links(연결선)에 선 종류 칸 kind 하나.
--  · kind = 'line'(지금 선, 기본값 — 기존 행은 모두 이 값) · 'relation'(관계선: 가지 구조에 끼지 않고 멀리 떨어진 칸끼리 잇는 선).
--  · 관계선 이름은 지금 칸 label(1~40자), 방향은 지금 칸 ends(none·end·both)를 그대로 쓴다. 새 표·함수·트리거·정책 바꾸기 없음.
--  · 끝(노트 카드·글 상자)·같은 작업공간 검사·노트/상자를 지우면 선도 지워짐(on delete cascade)은 지금 그대로.
-- 기존 행: 값은 바뀌지 않는다(새 칸은 기본값 'line' = 지금 선 그대로).
-- 권한: owner만(기존 정책 note_board_links_owner_all 그대로). 새 칸 넣기 권한만 authenticated에 더한다(고치기 권한은 주지 않음 — 만든 뒤 종류는 안 바뀜).
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 적용 경로: 승인형 DB workflow 확장 규칙(기존 표의 새 칸 권한).
--   짝: docs/20261127020000_note_board_relation.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127020000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040100' and name = 'note_board_free_lines')
     or to_regclass('public.app_note_board_links') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_links')
         and attname = 'kind' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_kind_check')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')
         and polname = 'note_board_links_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_RELATION_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_links add column kind text not null default 'line';
alter table public.app_note_board_links add constraint app_note_board_links_kind_check check (kind in ('line', 'relation'));

grant insert (kind) on table public.app_note_board_links to authenticated;

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
     or not has_column_privilege('authenticated', t, 'kind', 'insert')
     or has_column_privilege('authenticated', t, 'kind', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_links_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0
     or exists (select 1 from public.app_note_board_links where kind <> 'line') then
    raise exception 'NOTE_BOARD_RELATION_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127020000', 'note_board_relation', array['S71-53: app_note_board_links kind column (line, relation)']);
commit;
