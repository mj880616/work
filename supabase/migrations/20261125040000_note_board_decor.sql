begin;
-- S69-91 ① 노트 보드 꾸미기(명진 2026-11-25 03:01 "파워포인트 처럼 도형 삽입 선 삽입 등 꾸밈 입력 자유롭게",
--   03:03 "배경 없는 텍스트도 추가 가능하게 크기 자유 이동 자유로워서 선 위에 놓기 등 자유롭게").
-- 앞 단계: 20261125020000_note_board_box_size(상자 높이·손으로 둔 가지) 기록이 있어야 한다. 설계: docs/design/note-board-mindmap.md 8절.
-- 바꾸는 것: 기존 표 app_note_board_texts(보드에만 있는 글 상자)에 꾸미기 칸만 더하고, 종류·모양·색·글 검사를 넓힌다. 새 표·함수·트리거·정책 바꾸기 없음.
--  종류 kind  : topic·sticky에 label(배경·테두리 없는 글자)·shape(도형) 더함. label·shape는 늘 혼자 선 칸(가지가 아님).
--  모양 shape : round·rect·pill·plain에 ellipse·diamond·triangle·arrow 더함.
--  색 color   : 채우기. 노트 색 0~7에 -1(없음)·8(바탕색)·9(진한 색) 더함. 비면 기본.
--  글 body    : 도형(shape)만 빈 글 허용(글 없는 도형). 나머지는 지금처럼 1~300자.
--  새 칸      : z(겹침 순서) · stroke(테두리 색 -1~9) · stroke_w(테두리 두께 1~8) · dash(점선) · alpha(투명도 10~100)
--               · bold(굵게) · align(left·center·right) · ink(글자 색 0~9).
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸 기본값 = 지금 모양 그대로).
-- 권한: owner만(기존 정책 note_board_texts_owner_all 그대로). 새 칸 넣기·고치기 권한만 authenticated에 더한다.
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 적용 경로: 기존 표의 새 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙(S68-42 새 칸 권한)이 받는다.
--   짝: docs/20261125040000_note_board_decor.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125020000' and name = 'note_board_box_size')
     or to_regclass('public.app_note_board_texts') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname in ('z', 'stroke', 'stroke_w', 'dash', 'alpha', 'bold', 'align', 'ink') and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname = 'pinned' and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_mindmap_check' and contype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_body_check' and contype = 'c')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')
         and polname = 'note_board_texts_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_DECOR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_texts add column z integer not null default 0;
alter table public.app_note_board_texts add column stroke smallint;
alter table public.app_note_board_texts add column stroke_w smallint;
alter table public.app_note_board_texts add column dash boolean not null default false;
alter table public.app_note_board_texts add column alpha smallint;
alter table public.app_note_board_texts add column bold boolean not null default false;
alter table public.app_note_board_texts add column align text;
alter table public.app_note_board_texts add column ink smallint;

alter table public.app_note_board_texts drop constraint app_note_board_texts_mindmap_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_mindmap_check check (
  (parent_id is null or parent_id <> id)
  and ord between 0 and 1000000
  and (side is null or side in (-1, 1))
  and kind in ('topic', 'sticky', 'label', 'shape')
  and (color is null or color between -1 and 9)
  and shape in ('round', 'rect', 'pill', 'plain', 'ellipse', 'diamond', 'triangle', 'arrow')
  and font between 1 and 4
  and (w is null or w between 60 and 600));
alter table public.app_note_board_texts drop constraint app_note_board_texts_body_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_body_check check (
  (kind = 'shape' and body = '')
  or (char_length(body) between 1 and 300 and btrim(body, E' \n') <> '' and translate(body, E'\n', '') !~ '[[:cntrl:]]'));
alter table public.app_note_board_texts add constraint app_note_board_texts_decor_check check (
  z between -100000 and 100000
  and (stroke is null or stroke between -1 and 9)
  and (stroke_w is null or stroke_w between 1 and 8)
  and (alpha is null or alpha between 10 and 100)
  and (align is null or align in ('left', 'center', 'right'))
  and (ink is null or ink between 0 and 9)
  and (kind not in ('label', 'shape') or parent_id is null));

grant insert (z, stroke, stroke_w, dash, alpha, bold, align, ink) on table public.app_note_board_texts to authenticated;
grant update (z, stroke, stroke_w, dash, alpha, bold, align, ink) on table public.app_note_board_texts to authenticated;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·보드 고치기 권한 없음, 트리거 없음. 다르면 전체 취소.
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
     or not has_column_privilege('authenticated', t, 'z', 'insert')
     or not has_column_privilege('authenticated', t, 'ink', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NOTE_BOARD_DECOR_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125040000', 'note_board_decor', array['S69-91: app_note_board_texts labels, shapes and decor columns (z, stroke, width, dash, alpha, bold, align, ink)']);
commit;
