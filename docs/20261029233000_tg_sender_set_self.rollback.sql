begin;
-- 20261029233000_tg_sender_set_self의 짝 되돌리기. 함수 1개와 이번 기록 1행만 지운다. 이름표 두 표와 그 안의 자료·권한·정책은 건드리지 않는다.
-- 이미 '나'로 표시한 줄의 is_self 값은 그대로 남는다(지우면 서버가 다시 내 부탁을 후보로 올릴 수 있으므로 필요하면 화면에서 먼저 '나 표시 빼기').
-- 지우기 전에 화면을 이전 판으로 되돌린다(이전 판은 이 함수를 부르지 않는다. 부르면 '아직 준비되지 않았어요'만 뜬다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function public.app_tg_sender_set_self(uuid, boolean);

delete from supabase_migrations.schema_migrations
  where version = '20261029233000' and name = 'tg_sender_set_self';
commit;
