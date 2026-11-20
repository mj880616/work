begin;
-- 20261120090000_mcp_claude_read의 짝 되돌리기. 새 표 2개(인덱스·정책 포함)·새 함수 12개와 이번 기록 1행만 지운다.
-- 기존 표·정책·권한·함수(app_is_workspace_owner·app_ledger_search·app_lock_note_folder_list)는 건드리지 않는다.
-- 순서(설계 4.5·7.6): ① Web2 스위치 끄기 ② Supabase OAuth 클라이언트 삭제·OAuth 서버 끄기 ③ docs/ops/mcp-claude-read-guard.rollback.sql(요청 전 함수·Storage 정책) ④ 이 파일.
-- 요청 전 함수가 아직 걸려 있으면 멈춘다(그 함수가 이 파일이 지우는 것에 기대지는 않지만 순서를 지키게).
-- 설정·기록 행이 있으면 멈춘다(설계 7.6: 지우기 전에 CC가 숫자만 확인하고 별도 SQL로 비운 뒤 다시 실행).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261120090000' and name = 'mcp_claude_read') <> 1 then
    raise exception 'MCP_CLAUDE_READ_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
             where r.rolname = 'authenticator' and x.v like 'pgrst.db\_pre\_request=%public.app\_mcp\_pre\_request%')
     or to_regprocedure('public.app_mcp_pre_request()') is not null then
    raise exception 'MCP_CLAUDE_READ_ROLLBACK_BLOCKED: undo docs/ops/mcp-claude-read-guard first';
  end if;
  if exists (select 1 from public.app_mcp_settings) or exists (select 1 from public.app_mcp_read_log) then
    raise exception 'MCP_CLAUDE_READ_ROLLBACK_BLOCKED: settings or log rows exist';
  end if;
end
$$;

drop function public.app_mcp_google_where();
drop function public.app_mcp_notes_search(text, text, integer);
drop function public.app_mcp_ledger_get(text);
drop function public.app_mcp_ledger_search(text, text, text, date, date, integer);
drop function public.app_mcp_project_status(text);
drop function public.app_mcp_business_reports(date, date, text);
drop function public.app_mcp_org_status(text);
drop function private.app_mcp_arg(text, integer);
drop function private.app_mcp_clip(text, integer);
drop function private.app_mcp_note_locks();
drop function private.app_mcp_gate_done(text, integer, integer);
drop function private.app_mcp_gate(text);

drop table public.app_mcp_read_log;
drop table public.app_mcp_settings;

delete from supabase_migrations.schema_migrations
  where version = '20261120090000' and name = 'mcp_claude_read';
commit;
