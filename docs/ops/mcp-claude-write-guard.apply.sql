begin;
-- MCP-Claude쓰기 L1(설계 docs/design/mcp-claude-write.md 7절 순서 3). SQL Editor(폰 경로 C) 전용 — 짝: mcp-claude-write-guard.precheck.sql · .rollback.sql.
-- 무엇: 요청 전 함수 public.app_mcp_pre_request()의 허용 RPC 이름 목록만 17개 → 19개(app_mcp_write·app_mcp_write_tools)로 넓힌다.
--   되돌리기 함수 app_mcp_write_undo는 넣지 않는다(화면 전용 — 위임 열쇠는 L1에서 403, 함수 안에서도 거절).
--   본문의 다른 줄·INVOKER·search_path·실행권·authenticator 설정은 3판 파일(mcp-claude-read-guard-areas.apply.sql)과 같다. 데이터를 읽지 않는다.
-- 위험: 이 함수가 오류를 내면 REST 전체가 멈춘다. 적용 직후 Web2·읽생기 화면을 연다. 멈추면 mcp-claude-read-guard.rollback.sql 1단계(요청 전 설정 해제)를 바로 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261128100000' and name = 'mcp_claude_write') <> 1
     or to_regprocedure('public.app_mcp_pre_request()') is null
     or not exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
                    where r.rolname = 'authenticator' and x.v = 'pgrst.db_pre_request=public.app_mcp_pre_request')
     or pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) not like '%(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where|day_list|day_get|calls_list|call_get|recordings_list|recording_get|basket_search|basket_get|family_list|family_get)$%' then
    raise exception 'MCP_CLAUDE_WRITE_GUARD_PREREQUISITE_CHANGED; stop';
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
        !~ '^/rpc/app_mcp_(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where|day_list|day_get|calls_list|call_get|recordings_list|recording_get|basket_search|basket_get|family_list|family_get|write|write_tools)$' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
end
$$;
revoke all on function public.app_mcp_pre_request() from public;
grant execute on function public.app_mcp_pre_request() to anon, authenticated, service_role;

notify pgrst, 'reload config';
commit;
