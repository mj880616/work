begin;
-- MCP-Claude쓰기 L1 되돌리기. SQL Editor(폰 경로 C) 전용. 요청 전 함수의 허용 목록을 3판의 17개로 되돌린다(본문은 mcp-claude-read-guard-areas.apply.sql과 같음).
-- 20261128100000_mcp_claude_write의 rollback보다 먼저 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.app_mcp_pre_request()') is null
     or pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) not like '%write\_tools%' then
    raise exception 'MCP_CLAUDE_WRITE_GUARD_ROLLBACK_BLOCKED: function absent or already the 3rd edition list';
  end if;
end
$$;

create or replace function public.app_mcp_pre_request()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_client text;
begin
  if v_claims is null then
    return;
  end if;
  v_client := coalesce(v_claims::jsonb ->> 'client_id', '');
  if v_client = '' then
    return;
  end if;
  if coalesce(current_setting('request.method', true), '') <> 'POST'
     or coalesce(current_setting('request.path', true), '')
        !~ '^/rpc/app_mcp_(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where|day_list|day_get|calls_list|call_get|recordings_list|recording_get|basket_search|basket_get|family_list|family_get)$' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
end
$$;
revoke all on function public.app_mcp_pre_request() from public;
grant execute on function public.app_mcp_pre_request() to anon, authenticated, service_role;

notify pgrst, 'reload config';
commit;
