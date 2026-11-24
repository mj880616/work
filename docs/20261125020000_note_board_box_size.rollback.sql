begin;
-- 20261125020000_note_board_box_size의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 새 칸이 없으면 높이·손으로 둔 가지 자리 저장만 건너뛴다).
-- 지우는 것: 새 칸 2개(높이 h·손으로 둔 자리 pinned)와 새 제약·칸 권한, 이번 기록 1행.
--   글 상자 행은 지우지 않는다(손으로 옮긴 가지는 다시 자동 배치, 높이는 글 길이만큼). 폭·선·노트·카드 자리도 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125020000' and name = 'note_board_box_size') <> 1 then
    raise exception 'NOTE_BOARD_BOX_SIZE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_note_board_texts drop constraint app_note_board_texts_frame_check;
alter table public.app_note_board_texts drop column h;
alter table public.app_note_board_texts drop column pinned;

delete from supabase_migrations.schema_migrations
  where version = '20261125020000' and name = 'note_board_box_size';
commit;
