begin;
-- 20261029170000_tg_room_day_seen의 짝 되돌리기. 함수 1개와 seen_at 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖). '봤음' 기록만 사라진다(화면은 점·흐림 없이 지금처럼 보인다). 소식·요약·숨김 줄은 그대로다.
-- seen_at만 든 줄(요약 묶음 빈 배열)이 남을 수 있으나 목록·요약은 빈 묶음을 '요약 없음'으로 다루므로 지우지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261029170000' and name = 'tg_room_day_seen') <> 1 then
    raise exception 'TG_SEEN_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_feed_room_day_seen(text, date);

alter table public.app_feed_room_days drop column seen_at;

delete from supabase_migrations.schema_migrations
  where version = '20261029170000' and name = 'tg_room_day_seen';
commit;
