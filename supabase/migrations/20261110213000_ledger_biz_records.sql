begin;
-- S56-27 LEDGER-사업기록재료(RECORD-한줄 B-5에서 남은 일, docs/design/record-one.md 4절 '원장 자동 기록' 줄).
-- 원장 자동 기록(ai-assist ledger_auto)이 사업 기록(app_business_records, 20261109110000_record_one_biz)을 재료로 읽을 수 있게,
-- 원문 종류 목록에 biz_record 하나를 더한다. 근거 위치는 web2:biz_record:<사업 기록 id>(다른 표를 가리키는 project_update를 빌려 쓰지 않음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). DB 먼저, ai-assist 배포는 그 뒤.
--
-- 무엇(값 목록만 넓힘):
--   1) 종류 도우미 private.app_auto_ledger_source_kind_ok(text)를 같은 서명·같은 성질(sql, immutable, invoker, search_path '')로 교체해 biz_record를 더한다.
--      출처 도우미 app_auto_ledger_source와 실행 기록 함수 app_auto_ledger_record는 이 도우미를 부르므로 고치지 않는다.
--      실행권은 지금과 같다: PUBLIC·anon·service_role 회수, authenticated만.
--   2) 처리 표 app_ledger_auto_sources의 종류 CHECK(app_ledger_auto_sources_kind_check)에 biz_record를 더한다(글자 목록, 도우미와 같은 열 종류).
-- 안 하는 것: 표·칸·정책·표 권한·트리거·기존 기록·근거 변경, service_role 권한, SECURITY DEFINER, RTW 표·함수.
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): biz_record 처리 표 행·원장 출처가 하나라도 있으면 멈춘다. 없으면 도우미·CHECK를 아홉 종류로 되돌린다.
-- 짝: docs/20261110213000_ledger_biz_records.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 없거나, 이미 적용됐거나, 도우미·CHECK·사업 기록 표가 예상 모양이 아니면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110213000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025110000' and name = 'ledger_sources') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261109110000' and name = 'record_one_biz') <> 1
     or to_regclass('public.app_ledger_auto_sources') is null
     or to_regclass('public.app_business_records') is null
     -- 도우미가 앞 단계(20261025110000) 본문·성질 그대로다(다른 판이 끼어 있으면 멈춤).
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_auto_ledger_source_kind_ok(text)')
         and not prosecdef and provolatile = 'i' and proconfig = array['search_path=""']
         and md5(prosrc) = '0fe4c85202f976473f769c57275326ed') <> 1
     -- 처리 표 종류 CHECK가 앞 단계 모양(아홉 종류)이고 biz_record가 아직 없다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_ledger_auto_sources'::regclass and conname = 'app_ledger_auto_sources_kind_check'
         and pg_get_constraintdef(oid) like '%''calendar_ref''%' and pg_get_constraintdef(oid) not like '%biz_record%') <> 1
     -- 출처·실행 기록 함수가 도우미를 부른다(그래서 이 둘은 고치지 않는다).
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'), to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)'))
         and not prosecdef and prosrc like '%app_auto_ledger_source_kind_ok%') <> 2 then
    raise exception 'LEDGER_BIZ_RECORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 원문 종류 도우미: 열 종류. 모르는 값·null은 false.
create or replace function private.app_auto_ledger_source_kind_ok(p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref', 'biz_record'), false)
$$;
revoke all on function private.app_auto_ledger_source_kind_ok(text) from public, anon, service_role;
grant execute on function private.app_auto_ledger_source_kind_ok(text) to authenticated;

-- 2) 처리 표 종류 CHECK에 biz_record를 더한다(권한·정책 아님).
alter table public.app_ledger_auto_sources drop constraint app_ledger_auto_sources_kind_check,
  add constraint app_ledger_auto_sources_kind_check check (source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref', 'biz_record'));

-- 사후 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_ledger_auto_sources'::regclass and conname = 'app_ledger_auto_sources_kind_check'
      and convalidated and pg_get_constraintdef(oid) like '%''biz_record''%' and pg_get_constraintdef(oid) like '%''calendar_ref''%'
      and pg_get_constraintdef(oid) like '%''basket''%') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_auto_ledger_source_kind_ok(text)')
         and not prosecdef and provolatile = 'i' and proconfig = array['search_path=""']
         and prosrc like '%''biz_record''%' and prosrc like '%''calendar_ref''%' and prosrc like '%''basket''%' and prosrc not like '%telegram%'
         and coalesce(proacl::text, '') !~ '(^|[{,])(anon|service_role)?='
         and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')) <> 1 then
    raise exception 'LEDGER_BIZ_RECORDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110213000', 'ledger_biz_records', array['S56-27 LEDGER-사업기록재료: ledger auto source kind biz_record (helper private.app_auto_ledger_source_kind_ok replaced with the same signature and grants, app_ledger_auto_sources kind CHECK widened); no table, policy or grant change']);
commit;
