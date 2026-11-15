begin;
-- 20261021082000_ledger_schema의 짝 되돌리기. 새 표 10개(정책·색인·트리거 포함)·함수 6개·기록 1행만 지운다.
-- 원장 표에 한 줄이라도 있으면 멈춘다(번호표 포함). 내용을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 가져오기 되돌리기(S7-b 4단계)나 주간 Drive 내보내기로 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_ledger_audit, public.app_ledger_candidates, public.app_ledger_links, public.app_ledger_record_sources,
  public.app_ledger_records, public.app_ledger_sources, public.app_ledger_organizations, public.app_ledger_topics,
  public.app_ledger_id_counters, public.app_ledger_imports in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261021082000' and name = 'ledger_schema') <> 1 then
    raise exception 'LEDGER_SCHEMA_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_ledger_audit) or exists (select 1 from public.app_ledger_candidates)
     or exists (select 1 from public.app_ledger_links) or exists (select 1 from public.app_ledger_record_sources)
     or exists (select 1 from public.app_ledger_records) or exists (select 1 from public.app_ledger_sources)
     or exists (select 1 from public.app_ledger_organizations) or exists (select 1 from public.app_ledger_topics)
     or exists (select 1 from public.app_ledger_id_counters) or exists (select 1 from public.app_ledger_imports) then
    raise exception 'LEDGER_SCHEMA_ROLLBACK_BLOCKED: ledger rows exist; export or revert imports first';
  end if;
end
$$;

drop function public.app_ledger_search(text, text[], uuid, uuid, date, date, text, text, boolean, integer);
drop table public.app_ledger_audit;
drop table public.app_ledger_candidates;
drop table public.app_ledger_links;
drop table public.app_ledger_record_sources;
drop table public.app_ledger_records;
drop table public.app_ledger_sources;
drop table public.app_ledger_organizations;
drop table public.app_ledger_topics;
drop table public.app_ledger_id_counters;
drop table public.app_ledger_imports;
drop function private.app_ledger_assign_id();
drop function private.app_ledger_counter_guard();
drop function private.app_ledger_touch();
drop function private.app_ledger_decided_guard();
drop function private.app_ledger_audit_change();

delete from supabase_migrations.schema_migrations
  where version = '20261021082000' and name = 'ledger_schema';
commit;
