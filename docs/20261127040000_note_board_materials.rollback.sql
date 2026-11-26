begin;
-- 20261127040000_note_board_materials의 짝 되돌리기(SQL Editor·폰 경로 C 전용).
-- 지우기 전에 화면을 이전 판으로 되돌린다(새 화면은 재료 칸이 없으면 재료 잇기를 보이지 않는다).
-- 지우는 것: 좁히기 정책, 재료 색인·검사, 새 칸 mat_note·mat_doc·mat_url(과 그 칸 권한), 이번 기록 1행. 종류 검사·끝 검사는 앞 단계 모양으로 되돌린다.
-- 이미 이은 재료가 있으면 지우지 않고 멈춘다(자료를 지워 통과시키지 않음).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127040000' and name = 'note_board_materials') <> 1 then
    raise exception 'NOTE_BOARD_MATERIALS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_board_links where kind = 'material' or mat_note is not null or mat_doc is not null or mat_url is not null) then
    raise exception 'NOTE_BOARD_MATERIALS_ROLLBACK_BLOCKED: materials in use';
  end if;
end
$$;

drop policy note_board_links_material_own on public.app_note_board_links;
drop index public.app_note_board_links_material_key;
drop index public.app_note_board_links_material_note_idx;
drop index public.app_note_board_links_material_doc_idx;
alter table public.app_note_board_links drop constraint app_note_board_links_url_check;
alter table public.app_note_board_links drop constraint app_note_board_links_material_check;
alter table public.app_note_board_links drop constraint app_note_board_links_end_one_check;
alter table public.app_note_board_links add constraint app_note_board_links_end_one_check
  check (num_nonnulls(from_note, from_text, from_x) = 1 and num_nonnulls(to_note, to_text, to_x) = 1);
alter table public.app_note_board_links drop constraint app_note_board_links_kind_check;
alter table public.app_note_board_links add constraint app_note_board_links_kind_check check (kind in ('line', 'relation'));
alter table public.app_note_board_links drop column mat_url;
alter table public.app_note_board_links drop column mat_doc;
alter table public.app_note_board_links drop column mat_note;

delete from supabase_migrations.schema_migrations
  where version = '20261127040000' and name = 'note_board_materials';
commit;
