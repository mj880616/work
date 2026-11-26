begin;
-- 20261127000000_note_board_wide_coords의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 음수·먼 좌표를 저장하려 한다).
-- 되돌리는 것: 두 검사를 옛 범위(0~100,000)로, 이번 기록 1행.
-- 이미 옛 범위 밖(음수·100,000 넘음) 자리가 있으면 지우거나 옮기지 않고 멈춘다(자료를 바꿔 통과시키지 않음 — 화면에서 옮긴 뒤 다시 실행).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127000000' and name = 'note_board_wide_coords') <> 1 then
    raise exception 'NOTE_BOARD_WIDE_COORDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_texts where x not between 0 and 100000 or y not between 0 and 100000)
     or exists (select 1 from public.app_note_board_links where (from_x is not null and (from_x not between 0 and 100000 or from_y not between 0 and 100000))
       or (to_x is not null and (to_x not between 0 and 100000 or to_y not between 0 and 100000))) then
    raise exception 'NOTE_BOARD_WIDE_COORDS_ROLLBACK_BLOCKED: places outside the old range in use';
  end if;
end
$$;

alter table public.app_note_board_texts drop constraint app_note_board_texts_place_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_place_check check (x between 0 and 100000 and y between 0 and 100000);
alter table public.app_note_board_links drop constraint app_note_board_links_point_check;
alter table public.app_note_board_links add constraint app_note_board_links_point_check check (
  (from_x is null) = (from_y is null) and (to_x is null) = (to_y is null)
  and (from_x is null or (from_x between 0 and 100000 and from_y between 0 and 100000))
  and (to_x is null or (to_x between 0 and 100000 and to_y between 0 and 100000))
  and (color is null or color between 0 and 9)
  and (width is null or width between 1 and 8));

delete from supabase_migrations.schema_migrations
  where version = '20261127000000' and name = 'note_board_wide_coords';
commit;
