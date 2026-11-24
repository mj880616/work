begin;
-- S69-91 ① 노트 보드 선 넣기(명진 2026-11-25 03:01 "파워포인트 처럼 도형 삽입 선 삽입 등").
-- 앞 단계: 20261125040000_note_board_decor 기록이 있어야 한다. 설계: docs/design/note-board-mindmap.md 8절.
-- 바꾸는 것: 기존 표 app_note_board_links(연결선)의 끝에 '판 위 한 점'을 더한다 — 넣은 선은 양 끝이 점으로 시작하고,
--   끝을 상자·도형·카드에 놓으면 지금 잇기처럼 그 끝(노트·글 상자)이 되어 따라다닌다. 새 표·함수·트리거·정책 바꾸기 없음.
--  끝        : 끝마다 노트·글 상자·점(from_x·from_y / to_x·to_y, 0~100000) 중 정확히 하나.
--  모양 shape: line·curve에 elbow(꺾은선) 더함.
--  새 칸     : color(선 색 0~9) · width(두께 1~8). 비면 기본.
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸 비움 = 지금 선 그대로). 정책(같은 작업공간 노트만)은 그대로 — 점 끝은 노트가 아니므로 검사 대상이 아니다.
-- 권한: owner만. 새 칸 넣기·고치기 권한만 authenticated에 더한다. anon·PUBLIC·service_role 권한 없음.
-- 적용 경로: 기존 표의 새 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙(S68-42 새 칸 권한)이 받는다.
--   짝: docs/20261125040100_note_board_free_lines.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040100')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040000' and name = 'note_board_decor')
     or to_regclass('public.app_note_board_links') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_links')
         and attname in ('from_x', 'from_y', 'to_x', 'to_y', 'color', 'width') and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_end_one_check' and contype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_shape_check' and contype = 'c')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')
         and polname = 'note_board_links_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_FREE_LINES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_links add column from_x real;
alter table public.app_note_board_links add column from_y real;
alter table public.app_note_board_links add column to_x real;
alter table public.app_note_board_links add column to_y real;
alter table public.app_note_board_links add column color smallint;
alter table public.app_note_board_links add column width smallint;

alter table public.app_note_board_links drop constraint app_note_board_links_end_one_check;
alter table public.app_note_board_links add constraint app_note_board_links_end_one_check
  check (num_nonnulls(from_note, from_text, from_x) = 1 and num_nonnulls(to_note, to_text, to_x) = 1);
alter table public.app_note_board_links drop constraint app_note_board_links_shape_check;
alter table public.app_note_board_links add constraint app_note_board_links_shape_check check (shape in ('curve', 'line', 'elbow'));
alter table public.app_note_board_links add constraint app_note_board_links_point_check check (
  (from_x is null) = (from_y is null) and (to_x is null) = (to_y is null)
  and (from_x is null or (from_x between 0 and 100000 and from_y between 0 and 100000))
  and (to_x is null or (to_x between 0 and 100000 and to_y between 0 and 100000))
  and (color is null or color between 0 and 9)
  and (width is null or width between 1 and 8));

grant insert (from_x, from_y, to_x, to_y, color, width) on table public.app_note_board_links to authenticated;
grant update (from_x, from_y, to_x, to_y, color, width) on table public.app_note_board_links to authenticated;

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
     or has_column_privilege('authenticated', t, 'id', 'update')
     or has_column_privilege('authenticated', t, 'created_at', 'insert')
     or not has_column_privilege('authenticated', t, 'from_x', 'insert')
     or not has_column_privilege('authenticated', t, 'width', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_links_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NOTE_BOARD_FREE_LINES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125040100', 'note_board_free_lines', array['S69-91: app_note_board_links point ends, elbow shape, line color and width']);
commit;
