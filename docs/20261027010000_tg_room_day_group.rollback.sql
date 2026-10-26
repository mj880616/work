begin;
-- 20261027010000_tg_room_day_group의 짝 되돌리기(SQL Editor 경로 전용: 자료 보호 확인(DO 블록)이 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 새 표 셋(app_feed_folders, app_feed_rooms, app_feed_room_days) 중 한 곳이라도 한 줄이라도 있으면 멈춘다(폴더·보관·삭제 표시와 하루 요약을 잃지 않으려고). 그때 순서:
--   1) 필요하면 화면에서 폴더·보관·삭제 표시를 따로 적어 둔다(이 되돌리기는 세 표를 지우므로 요약도 함께 사라진다. 하루 요약은 AI가 쓴 것이라 다시 만들면 비용이 든다).
--   2) 명진이 "버려도 된다"고 결정했을 때만 세 표를 비운 뒤(SQL Editor에서 별도 승인) 이 되돌리기를 실행한다. 이 파일은 줄을 지우지 않는다.
-- 순서: 함수 9개 삭제 → 새 표 셋 삭제(정책·색인 함께) → 소식 표의 색인 삭제 → 기록 1행 삭제. 소식 표(app_feed_items)의 줄·권한·정책은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261027010000' and name = 'tg_room_day_group') <> 1 then
    raise exception 'TG_ROOM_DAY_GROUP_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_folders) or exists (select 1 from public.app_feed_rooms) or exists (select 1 from public.app_feed_room_days) then
    raise exception 'TG_ROOM_DAY_GROUP_ROLLBACK_BLOCKED: folders, room states or day summaries exist; decide to discard them first';
  end if;
end
$$;

drop function public.app_feed_room_day_lines(date, date);
drop function public.app_feed_folder_delete(uuid);
drop function public.app_feed_folder_rename(uuid, text);
drop function public.app_feed_folder_create(text);
drop function public.app_feed_room_day_set(text, date, text);
drop function public.app_feed_room_set(text, uuid, boolean);
drop function public.app_feed_room_day_add(uuid, text, date, jsonb);
drop function public.app_feed_room_touch(uuid, text, text, text, text);
drop function private.app_feed_owner_workspace();
drop table public.app_feed_room_days;
drop table public.app_feed_rooms;
drop table public.app_feed_folders;
drop index public.app_feed_items_tg_room_day_idx;

delete from supabase_migrations.schema_migrations
  where version = '20261027010000' and name = 'tg_room_day_group';
commit;
