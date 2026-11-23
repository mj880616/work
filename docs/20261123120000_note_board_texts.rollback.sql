begin;
-- 20261123120000_note_board_texts의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 글 상자·곡선을 쓰지 않는 이전 판으로 되돌린다(새 화면은 새 칸이 없으면 옛 칸으로 읽고 글 상자·곡선만 '준비 중'으로 알린다).
-- 지우는 것: 글 상자 표(글 상자와 그 선 — 글 상자 끝 선은 노트↔노트가 아니라 옛 표 모양에 들어갈 수 없다), 연결선의 새 칸 4개(곡선 점 — 곡선이던 선은 옛 자동 곡선으로 보인다),
--   새 제약·색인·권한, 정책을 옛 정의로, 비움 금지·기본값(curve)을 옛 값으로, 이번 기록 1행. 노트·카드 자리·노트↔노트 선의 나머지 칸은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261123120000' and name = 'note_board_texts') <> 1 then
    raise exception 'NOTE_BOARD_TEXTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop policy note_board_links_owner_all on public.app_note_board_links;
create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_notes n
      where n.id = from_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note')
    and exists (
      select 1 from public.app_notes n
      where n.id = to_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'));

-- 글 상자 끝 선을 먼저 지운다(옛 비움 금지를 되살리기 위해).
delete from public.app_note_board_links where from_text is not null or to_text is not null;
drop index public.app_note_board_links_end_key;
drop index public.app_note_board_links_from_text_idx;
drop index public.app_note_board_links_to_text_idx;
alter table public.app_note_board_links drop constraint app_note_board_links_bend_check;
alter table public.app_note_board_links drop constraint app_note_board_links_text_self_check;
alter table public.app_note_board_links drop constraint app_note_board_links_end_one_check;
alter table public.app_note_board_links drop constraint app_note_board_links_from_text_fkey;
alter table public.app_note_board_links drop constraint app_note_board_links_to_text_fkey;
alter table public.app_note_board_links drop column from_text;
alter table public.app_note_board_links drop column to_text;
alter table public.app_note_board_links drop column bend_x;
alter table public.app_note_board_links drop column bend_y;
alter table public.app_note_board_links alter column shape set default 'curve';
alter table public.app_note_board_links alter column from_note set not null;
alter table public.app_note_board_links alter column to_note set not null;
drop table public.app_note_board_texts;

delete from supabase_migrations.schema_migrations
  where version = '20261123120000' and name = 'note_board_texts';
commit;
