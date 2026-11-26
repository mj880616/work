begin;
-- 20261127050000_note_board_cells의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 표·파일 칸이 없으면 [표]·[파일]을 '준비 중'으로 알린다).
-- 지우는 것: 좁히기 정책, 파일 색인, 표·파일 검사, 새 칸 cells·file_doc·file_note·file_drive(과 그 칸 권한), 이번 기록 1행.
-- 종류 검사·글 검사는 앞 단계(20261125040000_note_board_decor) 모양으로 되돌린다.
-- 이미 표·파일 칸이 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음 — 화면에서 먼저 지운 뒤 다시 실행).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127050000' and name = 'note_board_cells') <> 1 then
    raise exception 'NOTE_BOARD_CELLS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_texts
      where kind in ('table', 'file') or cells is not null or file_doc is not null or file_note is not null or file_drive is not null) then
    raise exception 'NOTE_BOARD_CELLS_ROLLBACK_BLOCKED: table or file cells in use';
  end if;
end
$$;

drop policy note_board_texts_file_own on public.app_note_board_texts;
alter table public.app_note_board_texts drop constraint app_note_board_texts_file_check;
alter table public.app_note_board_texts drop constraint app_note_board_texts_cells_check;
alter table public.app_note_board_texts drop constraint app_note_board_texts_body_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_body_check check (
  (kind = 'shape' and body = '')
  or (char_length(body) between 1 and 300 and btrim(body, E' \n') <> '' and translate(body, E'\n', '') !~ '[[:cntrl:]]'));
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
drop index public.app_note_board_texts_file_note_idx;
drop index public.app_note_board_texts_file_doc_idx;
alter table public.app_note_board_texts drop column file_drive;
alter table public.app_note_board_texts drop column file_note;
alter table public.app_note_board_texts drop column file_doc;
alter table public.app_note_board_texts drop column cells;

delete from supabase_migrations.schema_migrations
  where version = '20261127050000' and name = 'note_board_cells';
commit;
