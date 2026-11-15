begin;
-- 20261021150000_ledger_import의 짝 되돌리기. 가져오기 함수 4개와 기록 1행만 지운다.
-- 원장 표·행·가져오기 묶음은 건드리지 않는다(이미 가져온 원장은 그대로 남고, 화면의 가져오기·되돌리기 단추만 "함수 준비 전"이 된다).
-- 이미 적용한 묶음을 지우려면 이 rollback 전에 화면에서 [되돌리기]를 먼저 한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
drop function if exists public.app_import_ledger_apply(uuid, jsonb, boolean);
drop function if exists public.app_import_ledger_revert(uuid);
drop function if exists public.app_import_ledger_confirm(uuid);
drop function if exists public.app_import_ledger_counts(uuid);
delete from supabase_migrations.schema_migrations where version = '20261021150000' and name = 'ledger_import';
commit;
