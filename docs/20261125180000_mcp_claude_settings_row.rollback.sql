begin;
-- 20261125180000_mcp_claude_settings_row의 짝 되돌리기. 운영자 작업공간의 설정 1행과 기록 1행을 지운다.
-- 설정 행이 없으면 문지기(private.app_mcp_gate)가 모든 Claude 호출을 거절한다(연결 전과 같음). 표·정책·권한·함수는 그대로.
-- 그 사이 본인이 화면에서 켰더라도 지운다(= 연결 끊김). 호출 기록 표(app_mcp_read_log)는 건드리지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 기록 행 DELETE 말고 자료 DELETE를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261125180000' and name = 'mcp_claude_settings_row') <> 1
     or (select count(*) from public.app_mcp_settings) <> 1
     or (select count(*) from public.app_mcp_settings s where s.workspace_id in (select f.workspace_id from public.app_operator_features f)) <> 1 then
    raise exception 'MCP_SETTINGS_ROW_ROLLBACK_BLOCKED: state differs';
  end if;
end
$$;

delete from public.app_mcp_settings
  where workspace_id in (select f.workspace_id from public.app_operator_features f);

delete from supabase_migrations.schema_migrations
  where version = '20261125180000' and name = 'mcp_claude_settings_row';
commit;
