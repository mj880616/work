begin;
-- 20261027030000_tg_sender_names_read의 짝 되돌리기. 읽기 전용 함수 1개와 기록 1행만 지운다. 이름표 두 표와 그 안의 자료·권한·정책은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function public.app_tg_sender_names_for_day(uuid, text, date);

delete from supabase_migrations.schema_migrations
  where version = '20261027030000' and name = 'tg_sender_names_read';
commit;
