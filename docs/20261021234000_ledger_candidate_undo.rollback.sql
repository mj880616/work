begin;
-- 20261021234000_ledger_candidate_undo의 짝 되돌리기(SQL Editor 전용: 트리거를 다시 바꾸므로 승인형 workflow rollback 모드 대상 아님).
-- 후보 잠금 트리거를 원래 함수(private.app_ledger_decided_guard('pending'))로 되돌리고, 새 함수 2개와 기록 1행만 지운다.
-- 원장 행·후보·감사 기록은 건드리지 않는다(이미 되돌린 후보는 대기로, 폐기한 기록은 폐기로 남는다. 화면의 [확정 취소]만 숨는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create or replace trigger app_ledger_candidates_guard before update on public.app_ledger_candidates
  for each row execute function private.app_ledger_decided_guard('pending');
drop function if exists public.app_unconfirm_ledger_candidate(uuid);
drop function if exists private.app_guard_ledger_candidate();
delete from supabase_migrations.schema_migrations where version = '20261021234000' and name = 'ledger_candidate_undo';
commit;
