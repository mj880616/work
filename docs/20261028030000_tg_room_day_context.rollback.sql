begin;
-- 20261028030000_tg_room_day_context의 짝 되돌리기. 읽기 전용 함수 1개와 기록 1행만 지운다. 소식 표와 그 안의 자료·권한·정책은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function public.app_feed_room_day_context(uuid, text, date);

delete from supabase_migrations.schema_migrations
  where version = '20261028030000' and name = 'tg_room_day_context';
commit;
