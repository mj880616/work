begin;
-- 20261021190000_ledger_candidates의 짝 되돌리기. 후보 함수 2개와 기록 1행만 지운다.
-- 원장 표·행·후보·가져오기 묶음은 건드리지 않는다(이미 확정한 원장 행과 후보는 그대로 남고, 화면의 후보 칸만 숨는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
drop function if exists public.app_confirm_ledger_candidate(uuid, jsonb);
drop function if exists public.app_queue_ledger_candidates(uuid, jsonb, boolean);
delete from supabase_migrations.schema_migrations where version = '20261021190000' and name = 'ledger_candidates';
commit;
