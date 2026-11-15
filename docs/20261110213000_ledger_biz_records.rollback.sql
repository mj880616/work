begin;
-- 20261110213000_ledger_biz_records의 짝 되돌리기(SQL Editor 경로 전용: 함수 본문 복원은 workflow rollback 허용 목록 밖).
-- 순서: 먼저 ai-assist를 사업 기록을 읽지 않는 이전 판(배포 때 기록한 되돌리기 ref)으로 되돌린다. 그다음 이 파일.
-- biz_record 처리 표 행·원장 출처(web2:biz_record:…)가 하나라도 있으면 멈춘다. 그때는:
--   1) 원장 화면에서 그 원문에서 나온 기록을 틀림으로 표시하고(이 파일은 기록을 지우지 않는다) 필요하면 내보낸다.
--   2) 명진 확인 뒤, 처리 표 행·출처 삭제를 따로 승인받아 실행한다.
--   3) 그 다음에 이 파일을 실행한다.
-- 하는 일: 종류 도우미를 앞 단계(20261025110000) 본문 그대로 복원 → 처리 표 CHECK를 아홉 종류로 → 기록 1행 삭제. 실행권은 그대로(authenticated만).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261110213000' and name = 'ledger_biz_records') <> 1 then
    raise exception 'LEDGER_BIZ_RECORDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_ledger_auto_sources where source_kind = 'biz_record')
     or exists (select 1 from public.app_ledger_sources where location like 'web2:biz\_record:%') then
    raise exception 'LEDGER_BIZ_RECORDS_ROLLBACK_BLOCKED: biz_record rows exist; mark the records wrong, export, and delete these rows first with separate approval';
  end if;
end
$$;

-- 앞 단계(20261025110000) 본문 그대로.
create or replace function private.app_auto_ledger_source_kind_ok(p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref'), false)
$$;
revoke all on function private.app_auto_ledger_source_kind_ok(text) from public, anon, service_role;
grant execute on function private.app_auto_ledger_source_kind_ok(text) to authenticated;

alter table public.app_ledger_auto_sources drop constraint app_ledger_auto_sources_kind_check,
  add constraint app_ledger_auto_sources_kind_check check (source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref'));

delete from supabase_migrations.schema_migrations
  where version = '20261110213000' and name = 'ledger_biz_records';
commit;
