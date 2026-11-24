begin;
-- 20261125040100_note_board_free_lines의 짝 되돌리기(SQL Editor·폰 경로 C 전용). 앞 단계 20261125040000보다 먼저 되돌린다.
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 점 끝 칸이 없으면 선 넣기를 '준비 중'으로 알린다).
-- 지우는 것: 새 칸 6개(점 끝·선 색·두께)와 점 검사·칸 권한, 넓힌 끝·모양 검사를 옛 검사로, 이번 기록 1행.
-- 이미 넣은 점 끝 선·꺾은선이 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125040100' and name = 'note_board_free_lines') <> 1 then
    raise exception 'NOTE_BOARD_FREE_LINES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_links where from_x is not null or to_x is not null or shape = 'elbow') then
    raise exception 'NOTE_BOARD_FREE_LINES_ROLLBACK_BLOCKED: point-end or elbow lines in use';
  end if;
end
$$;

alter table public.app_note_board_links drop constraint app_note_board_links_point_check;
alter table public.app_note_board_links drop constraint app_note_board_links_shape_check;
alter table public.app_note_board_links add constraint app_note_board_links_shape_check check (shape in ('curve', 'line'));
alter table public.app_note_board_links drop constraint app_note_board_links_end_one_check;
alter table public.app_note_board_links add constraint app_note_board_links_end_one_check
  check (num_nonnulls(from_note, from_text) = 1 and num_nonnulls(to_note, to_text) = 1);
alter table public.app_note_board_links drop column from_x;
alter table public.app_note_board_links drop column from_y;
alter table public.app_note_board_links drop column to_x;
alter table public.app_note_board_links drop column to_y;
alter table public.app_note_board_links drop column color;
alter table public.app_note_board_links drop column width;

delete from supabase_migrations.schema_migrations
  where version = '20261125040100' and name = 'note_board_free_lines';
commit;
