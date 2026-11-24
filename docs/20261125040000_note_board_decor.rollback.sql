begin;
-- 20261125040000_note_board_decor의 짝 되돌리기(SQL Editor·폰 경로 C 전용). 뒤 단계 20261125040100_note_board_free_lines를 먼저 되돌린다.
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 꾸미기 칸이 없으면 글자·도형 넣기를 '준비 중'으로 알린다).
-- 지우는 것: 새 칸 8개와 꾸미기 검사·칸 권한, 넓힌 종류·모양·색·글 검사를 옛 검사로, 이번 기록 1행.
-- 이미 넣은 글자·도형(또는 새 모양·색)이 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음 — 지울지는 사용자가 화면에서 정한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125040000' and name = 'note_board_decor') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261125040100') then
    raise exception 'NOTE_BOARD_DECOR_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_texts
      where kind in ('label', 'shape') or shape in ('ellipse', 'diamond', 'triangle', 'arrow') or color < 0 or color > 7) then
    raise exception 'NOTE_BOARD_DECOR_ROLLBACK_BLOCKED: labels or shapes in use';
  end if;
end
$$;

alter table public.app_note_board_texts drop constraint app_note_board_texts_decor_check;
alter table public.app_note_board_texts drop constraint app_note_board_texts_body_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_body_check check (
  char_length(body) between 1 and 300 and btrim(body, E' \n') <> '' and translate(body, E'\n', '') !~ '[[:cntrl:]]');
alter table public.app_note_board_texts drop constraint app_note_board_texts_mindmap_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_mindmap_check check (
  (parent_id is null or parent_id <> id)
  and ord between 0 and 1000000
  and (side is null or side in (-1, 1))
  and kind in ('topic', 'sticky')
  and (color is null or color between 0 and 7)
  and shape in ('round', 'rect', 'pill', 'plain')
  and font between 1 and 4
  and (w is null or w between 60 and 600));
alter table public.app_note_board_texts drop column z;
alter table public.app_note_board_texts drop column stroke;
alter table public.app_note_board_texts drop column stroke_w;
alter table public.app_note_board_texts drop column dash;
alter table public.app_note_board_texts drop column alpha;
alter table public.app_note_board_texts drop column bold;
alter table public.app_note_board_texts drop column align;
alter table public.app_note_board_texts drop column ink;

delete from supabase_migrations.schema_migrations
  where version = '20261125040000' and name = 'note_board_decor';
commit;
