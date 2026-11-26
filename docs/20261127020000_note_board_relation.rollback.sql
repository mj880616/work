begin;
-- 20261127020000_note_board_relation의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 kind 칸이 없으면 관계선 만들기를 막고 '준비 중'으로 알린다).
-- 지우는 것: 새 칸 kind(과 그 칸 권한·종류 검사), 이번 기록 1행.
-- 이미 만든 관계선이 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음 — 관계선을 일반 선으로 바꾸지도 않음).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127020000' and name = 'note_board_relation') <> 1 then
    raise exception 'NOTE_BOARD_RELATION_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_links where kind <> 'line') then
    raise exception 'NOTE_BOARD_RELATION_ROLLBACK_BLOCKED: relation lines in use';
  end if;
end
$$;

alter table public.app_note_board_links drop constraint app_note_board_links_kind_check;
alter table public.app_note_board_links drop column kind;

delete from supabase_migrations.schema_migrations
  where version = '20261127020000' and name = 'note_board_relation';
commit;
