begin;
-- 20261024120000_ledger_auto_record의 짝 되돌리기(SQL Editor 경로 전용: 함수·표 삭제는 workflow rollback 허용 목록 밖).
-- 자동 실행·원문별 처리·수정 요청·변경 기록 행이 하나라도 있으면 멈춘다. 그때는 순서:
--   1) 앱의 [이번 자동 기록 취소]·[반영 취소]로 되돌려 만든 기록이 폐기·복원되게 한다(앱 PR 뒤. 그 전에는 해당 없음).
--   2) 원장 화면의 내보내기(Drive 사본·백업 파일)로 보관한다.
--   3) 명진 확인 뒤, 변경 기록·처리 표·수정 요청·실행 행의 삭제를 따로 승인받아 실행한다(이 파일은 행을 지우지 않는다).
--   4) 그 다음에 이 파일을 실행한다.
-- 순서: 함수 → 표(변경 기록 → 처리 표 → 수정 요청 → 실행) → 감사 CHECK를 옛 목록으로 → 기록 1행 삭제. 기존 원장 표의 데이터·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024120000' and name = 'ledger_auto_record') <> 1 then
    raise exception 'LEDGER_AUTO_RECORD_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_ledger_record_changes)
     or exists (select 1 from public.app_ledger_auto_sources)
     or exists (select 1 from public.app_ledger_fix_requests)
     or exists (select 1 from public.app_ledger_auto_runs)
     or exists (select 1 from public.app_ledger_audit where target_table in ('auto_runs', 'fix_requests')) then
    raise exception 'LEDGER_AUTO_RECORD_ROLLBACK_BLOCKED: auto-record rows exist; undo, export and delete them first with separate approval';
  end if;
end
$$;

drop function public.app_auto_ledger_begin(uuid);
drop function public.app_auto_ledger_record(uuid, jsonb);
drop function public.app_auto_ledger_undo(uuid);
drop function public.app_apply_ledger_fix(uuid, jsonb, boolean);
drop function public.app_undo_ledger_fix(uuid);
drop function private.app_auto_ledger_log(uuid, uuid, text, text, uuid, uuid, text, uuid, text, jsonb, text);
drop function private.app_auto_ledger_insert(uuid, text, text, text, jsonb);
drop function private.app_auto_ledger_source(uuid, jsonb);
drop function private.app_auto_ledger_personal(text);
drop table public.app_ledger_record_changes;
drop table public.app_ledger_auto_sources;
drop table public.app_ledger_fix_requests;
drop table public.app_ledger_auto_runs;
alter table public.app_ledger_audit drop constraint app_ledger_audit_target_check,
  add constraint app_ledger_audit_target_check check (
    (target_table is null) = (target_id is null)
    and (target_table is null or target_table in (
      'records', 'sources', 'organizations', 'topics', 'record_sources', 'links', 'candidates', 'imports')));

delete from supabase_migrations.schema_migrations where version = '20261024120000' and name = 'ledger_auto_record';
commit;
