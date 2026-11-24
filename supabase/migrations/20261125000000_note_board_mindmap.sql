begin;
-- S69-82 노트 보드 → 브레인스토밍·마인드맵(명진 2026-11-24 23:51 "전체를 브레인 스토밍 마인드맵 하게. 제대로 개선").
-- 앞 단계: 20261123120000_note_board_texts(글 상자 표) 기록이 있어야 한다. 설계: docs/design/note-board-mindmap.md.
-- 바꾸는 것: 기존 표 app_note_board_texts(보드에만 있는 글 상자)에 생각 지도 칸만 더한다. 새 표·함수·트리거·정책 바꾸기 없음.
--  parent_id  : 위 상자(가지의 부모). 비면 혼자 선 상자(뿌리). (parent_id, 작업공간, 보드) 세 칸 외래 키로 같은 작업공간·같은 보드 상자만,
--               위 상자를 지우면 그 아래 가지도 함께 지워진다(cascade). 자기 자신은 안 됨(check). 고리는 화면이 끊어 읽는다.
--  ord        : 형제 순서(0~1000000).   side : 뿌리 가지의 쪽(-1 왼쪽, 1 오른쪽, 비면 화면이 가벼운 쪽).
--  kind       : topic(주제 상자) | sticky(메모지).   color : 기존 노트 색 0~7(비면 기본).   shape : round|rect|pill|plain.
--  font       : 글자 크기 1~4.   w : 손으로 정한 폭 60~600(비면 글 길이만큼).   collapsed : 가지 접힘.
-- 기존 행: 한 줄도 바꾸지 않는다(새 칸은 기본값 — 옛 글 상자는 모두 혼자 선 주제 상자로 읽힌다).
-- 권한: owner만(기존 정책 note_board_texts_owner_all 그대로). 새 칸 넣기·고치기 권한만 authenticated에 더한다. 작업공간·보드는 지금처럼 못 고친다.
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 적용 경로: 기존 표의 새 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙(S68-42 새 칸 권한)이 받는다.
--   짝: docs/20261125000000_note_board_mindmap.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125000000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261123120000' and name = 'note_board_texts')
     or to_regclass('public.app_note_board_texts') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname in ('parent_id', 'ord', 'side', 'kind', 'color', 'shape', 'font', 'w', 'collapsed') and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_end_key' and contype = 'u')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')
         and polname = 'note_board_texts_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_MINDMAP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_texts add column parent_id uuid;
alter table public.app_note_board_texts add column ord integer not null default 0;
alter table public.app_note_board_texts add column side smallint;
alter table public.app_note_board_texts add column kind text not null default 'topic';
alter table public.app_note_board_texts add column color smallint;
alter table public.app_note_board_texts add column shape text not null default 'round';
alter table public.app_note_board_texts add column font smallint not null default 2;
alter table public.app_note_board_texts add column w integer;
alter table public.app_note_board_texts add column collapsed boolean not null default false;
alter table public.app_note_board_texts add constraint app_note_board_texts_parent_fkey
  foreign key (parent_id, workspace_id, board_id) references public.app_note_board_texts(id, workspace_id, board_id) on delete cascade;
alter table public.app_note_board_texts add constraint app_note_board_texts_mindmap_check check (
  (parent_id is null or parent_id <> id)
  and ord between 0 and 1000000
  and (side is null or side in (-1, 1))
  and kind in ('topic', 'sticky')
  and (color is null or color between 0 and 7)
  and shape in ('round', 'rect', 'pill', 'plain')
  and font between 1 and 4
  and (w is null or w between 60 and 600));
create index app_note_board_texts_parent_idx on public.app_note_board_texts(parent_id);

grant insert (parent_id, ord, side, kind, color, shape, font, w, collapsed) on table public.app_note_board_texts to authenticated;
grant update (parent_id, ord, side, kind, color, shape, font, w, collapsed) on table public.app_note_board_texts to authenticated;

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
     or not has_column_privilege('authenticated', t, 'parent_id', 'insert')
     or not has_column_privilege('authenticated', t, 'collapsed', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NOTE_BOARD_MINDMAP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125000000', 'note_board_mindmap', array['S69-82: app_note_board_texts mindmap columns (parent, order, side, kind, color, shape, font, width, collapsed)']);
commit;
