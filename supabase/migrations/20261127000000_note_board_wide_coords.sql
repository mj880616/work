begin;
-- S71-52 NOTE-큰생각지도(사용자 2026-11-26 "굉장히 광범위한 생각지도 … 무한정 뻗어나가는"): 노트 보드 판을 어느 방향으로나 뻗게.
-- 앞 단계: 20261125040100_note_board_free_lines 기록이 있어야 한다(선 점 끝 검사). 설계: docs/design/note-board-mindmap.md 10절.
-- 바꾸는 것: 검사 두 개의 좌표 범위만 넓힌다(0~100,000 → -1,000,000~1,000,000, 화면 note-board-coord.mjs와 같음).
--  · app_note_board_texts_place_check(글 상자·글자·도형 자리 x·y)
--  · app_note_board_links_point_check(선 점 끝 from_x·from_y·to_x·to_y) — 색·두께 범위는 그대로.
-- 기존 행: 한 줄도 바꾸지 않는다(지금 값은 모두 새 범위 안). 칸·권한·정책·트리거·색인은 그대로.
-- 노트 카드 자리(노트 metadata.boards)는 DB 검사가 없다(화면 검사만) — 이 변경과 무관.
-- 적용 경로: 승인형 DB workflow 엄격 규칙(기존 표 check 교체만, 권한 변경 없음).
--   짝: docs/20261127000000_note_board_wide_coords.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127000000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040100' and name = 'note_board_free_lines')
     or to_regclass('public.app_note_board_texts') is null
     or to_regclass('public.app_note_board_links') is null
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_note_board_texts')
         and conname = 'app_note_board_texts_place_check' and contype = 'c'
         and pg_get_constraintdef(oid) like '%100000%' and pg_get_constraintdef(oid) not like '%-1000000%') <> 1
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_note_board_links')
         and conname = 'app_note_board_links_point_check' and contype = 'c') then
    raise exception 'NOTE_BOARD_WIDE_COORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_note_board_texts drop constraint app_note_board_texts_place_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_place_check
  check (x between -1000000 and 1000000 and y between -1000000 and 1000000);
alter table public.app_note_board_links drop constraint app_note_board_links_point_check;
alter table public.app_note_board_links add constraint app_note_board_links_point_check check (
  (from_x is null) = (from_y is null) and (to_x is null) = (to_y is null)
  and (from_x is null or (from_x between -1000000 and 1000000 and from_y between -1000000 and 1000000))
  and (to_x is null or (to_x between -1000000 and 1000000 and to_y between -1000000 and 1000000))
  and (color is null or color between 0 and 9)
  and (width is null or width between 1 and 8));

-- 사후 확인: 두 표 모두 RLS 켜짐, anon·service_role 권한 없음, 새 검사 두 개가 있음, 트리거 없음. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_note_board_texts'::regclass, 'public.app_note_board_links'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
      raise exception 'NOTE_BOARD_WIDE_COORDS_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid = 'public.app_note_board_texts'::regclass and conname = 'app_note_board_texts_place_check'
        and pg_get_constraintdef(oid) like '%-1000000%') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_note_board_links'::regclass and conname = 'app_note_board_links_point_check'
        and pg_get_constraintdef(oid) like '%-1000000%') <> 1 then
    raise exception 'NOTE_BOARD_WIDE_COORDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127000000', 'note_board_wide_coords', array['S71-52: note board coordinate checks widened to -1000000..1000000 (texts place, links point ends)']);
commit;
