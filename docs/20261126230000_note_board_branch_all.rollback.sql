begin;
-- 20261126230000_note_board_branch_all의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 이 칸이 없으면 카드·글자·도형 가지만 '준비 중'으로 알린다).
-- 지우는 것: 새 칸 parent_note와 그 칸 권한·색인·'부모 하나' 검사·좁히기 정책, 꾸미기 검사를 옛 검사(글자·도형은 부모 없음)로, 이번 기록 1행.
-- 이미 카드 아래 가지나 글자·도형 가지가 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음 — 화면에서 떼어 낸 뒤 다시 실행).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126230000' and name = 'note_board_branch_all') <> 1 then
    raise exception 'NOTE_BOARD_BRANCH_ALL_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_texts
      where parent_note is not null or (kind in ('label', 'shape') and parent_id is not null)) then
    raise exception 'NOTE_BOARD_BRANCH_ALL_ROLLBACK_BLOCKED: card, label or shape branches in use';
  end if;
end
$$;

drop policy note_board_texts_parent_note_own on public.app_note_board_texts;
alter table public.app_note_board_texts drop constraint app_note_board_texts_decor_check;
alter table public.app_note_board_texts add constraint app_note_board_texts_decor_check check (
  z between -100000 and 100000
  and (stroke is null or stroke between -1 and 9)
  and (stroke_w is null or stroke_w between 1 and 8)
  and (alpha is null or alpha between 10 and 100)
  and (align is null or align in ('left', 'center', 'right'))
  and (ink is null or ink between 0 and 9)
  and (kind not in ('label', 'shape') or parent_id is null));
alter table public.app_note_board_texts drop constraint app_note_board_texts_parent_one_check;
drop index public.app_note_board_texts_parent_note_idx;
alter table public.app_note_board_texts drop column parent_note;

delete from supabase_migrations.schema_migrations
  where version = '20261126230000' and name = 'note_board_branch_all';
commit;
