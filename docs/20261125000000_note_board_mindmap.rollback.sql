begin;
-- 20261125000000_note_board_mindmap의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 새 칸이 없으면 옛 칸으로 읽고 가지·꾸미기만 '준비 중'으로 알린다).
-- 지우는 것: 새 칸 9개(가지 관계·순서·쪽·종류·색·모양·글자 크기·폭·접힘)와 새 제약·색인·칸 권한, 이번 기록 1행.
--   글 상자 행은 지우지 않는다(가지였던 상자는 위 상자 없이 혼자 선 상자로 남는다 — 자리 x·y 그대로). 선·노트·카드 자리도 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125000000' and name = 'note_board_mindmap') <> 1 then
    raise exception 'NOTE_BOARD_MINDMAP_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop index public.app_note_board_texts_parent_idx;
alter table public.app_note_board_texts drop constraint app_note_board_texts_mindmap_check;
alter table public.app_note_board_texts drop constraint app_note_board_texts_parent_fkey;
alter table public.app_note_board_texts drop column parent_id;
alter table public.app_note_board_texts drop column ord;
alter table public.app_note_board_texts drop column side;
alter table public.app_note_board_texts drop column kind;
alter table public.app_note_board_texts drop column color;
alter table public.app_note_board_texts drop column shape;
alter table public.app_note_board_texts drop column font;
alter table public.app_note_board_texts drop column w;
alter table public.app_note_board_texts drop column collapsed;

delete from supabase_migrations.schema_migrations
  where version = '20261125000000' and name = 'note_board_mindmap';
commit;
