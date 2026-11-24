begin;
-- S69-88 노트 보드 상자 크기·자유 이동(명진 2026-11-25 02:46 "입력창 자체를 자유자재로 크기 조절 … 높이 폭 모두", "이동도 자유롭고 파워포인트처럼").
-- 앞 단계: 20261125000000_note_board_mindmap(생각 지도 칸) 기록이 있어야 한다. 설계: docs/design/note-board-mindmap.md 7절.
-- 바꾸는 것: 기존 표 app_note_board_texts(보드에만 있는 글 상자)에 칸 두 개만 더한다. 새 표·함수·트리거·정책 바꾸기 없음.
--  h      : 손으로 정한 높이 30~1200(비면 글 길이만큼). 글이 더 길면 상자가 글만큼 커진다(최소 높이).
--  pinned : 가지 상자를 손으로 옮겨 둔 자리(x·y)를 쓴다(참이면 자동 배치가 덮어쓰지 않음, 가지 선은 따라감). 거짓이면 지금처럼 자동 배치.
-- 기존 행: 한 줄도 바꾸지 않는다(h 비움·pinned 거짓 = 지금 모양 그대로).
-- 권한: owner만(기존 정책 note_board_texts_owner_all 그대로). 새 칸 넣기·고치기 권한만 authenticated에 더한다.
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 적용 경로: 기존 표의 새 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙(S68-42 새 칸 권한)이 받는다.
--   짝: docs/20261125020000_note_board_box_size.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125020000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125000000' and name = 'note_board_mindmap')
     or to_regclass('public.app_note_board_texts') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname in ('h', 'pinned') and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_texts')
         and attname = 'w' and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_mindmap_check' and contype = 'c')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_texts')
         and polname = 'note_board_texts_owner_all') <> 1 then
    raise exception 'NOTE_BOARD_BOX_SIZE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_texts add column h integer;
alter table public.app_note_board_texts add column pinned boolean not null default false;
alter table public.app_note_board_texts add constraint app_note_board_texts_frame_check check (h is null or h between 30 and 1200);

grant insert (h, pinned) on table public.app_note_board_texts to authenticated;
grant update (h, pinned) on table public.app_note_board_texts to authenticated;

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
     or not has_column_privilege('authenticated', t, 'h', 'insert')
     or not has_column_privilege('authenticated', t, 'pinned', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'note_board_texts_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NOTE_BOARD_BOX_SIZE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125020000', 'note_board_box_size', array['S69-88: app_note_board_texts box height and pinned branch place']);
commit;
