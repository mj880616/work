begin;
-- 20261030060000_tg_room_pin의 짝 되돌리기. 함수 1개와 pinned_at 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖). '고정' 표시만 사라진다(화면은 고정 칸 없이 지금처럼 보인다). 방의 폴더·보관·소식·요약은 그대로다.
-- 고정할 때 새로 생긴 방 줄(폴더·보관 없음)이 남을 수 있으나 목록은 방 줄이 없을 때와 똑같이 보이므로 지우지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261030060000' and name = 'tg_room_pin') <> 1 then
    raise exception 'TG_PIN_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_feed_room_pin(text, boolean);

alter table public.app_feed_rooms drop column pinned_at;

delete from supabase_migrations.schema_migrations
  where version = '20261030060000' and name = 'tg_room_pin';
commit;
