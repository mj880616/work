begin;
-- MCP-Claude읽기 M-6 설정 행(S70-48, 설계 docs/design/mcp-claude-read.md 9절).
-- 무엇: 운영자 작업공간(public.app_operator_features에서 통화(calls) 기능이 켜진 작업공간 — 다른 운영자 기능만 켠 작업공간은 세지 않음) 하나에 public.app_mcp_settings 1행을 넣는다.
--   enabled=false(스위치는 꺼진 채, 켜기는 본인이 화면에서), allowed_client_id = auth.oauth_clients의 'Claude' 공개 클라이언트 id.
-- 공개 저장소: 작업공간 ID·클라이언트 ID·이메일을 이 파일에 쓰지 않는다. 값은 적용 때 DB에서 읽는다.
-- 멈춤(raise): 앞 단계(20261120090000_mcp_claude_read) 기록 없음, 이번 기록 이미 있음, 설정 표에 행이 이미 있음,
--   운영자 작업공간이 정확히 1개가 아님, 조건 맞는 Claude 클라이언트(이름 'Claude'·지워지지 않음·public·되돌아올 주소가 정확히
--   https://claude.ai/api/mcp/auth_callback 하나)가 정확히 1개가 아님, redirect_uris 칸이 text가 아님.
-- 바꾸지 않는 것: 표·칸·정책·권한·함수·트리거. 자료 1행만 넣는다.
-- 짝: docs/20261125180000_mcp_claude_settings_row.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125180000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261120090000' and name = 'mcp_claude_read') <> 1
     or to_regclass('public.app_mcp_settings') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('auth.oauth_clients') is null
     or (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
          where a.attrelid = to_regclass('auth.oauth_clients') and a.attname = 'redirect_uris' and a.attnum > 0 and not a.attisdropped)
        is distinct from 'text' then
    raise exception 'MCP_SETTINGS_ROW_PREREQUISITE_CHANGED; stop';
  end if;
  if exists (select 1 from public.app_mcp_settings) then
    raise exception 'MCP_SETTINGS_ROW_ALREADY_PRESENT; stop';
  end if;
  if (select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'calls') <> 1 then
    raise exception 'MCP_SETTINGS_ROW_OPERATOR_WORKSPACE_NOT_ONE; stop';
  end if;
  if (select count(*) from auth.oauth_clients c
       where c.client_name = 'Claude' and c.deleted_at is null and c.client_type::text = 'public'
         and c.redirect_uris = 'https://claude.ai/api/mcp/auth_callback') <> 1 then
    raise exception 'MCP_SETTINGS_ROW_CLIENT_NOT_ONE; stop';
  end if;
end
$$;

insert into public.app_mcp_settings (workspace_id, enabled, allowed_client_id, revoked_before, updated_at)
select w.workspace_id, false, c.id::text, null, now()
  from (select distinct f.workspace_id from public.app_operator_features f where f.feature = 'calls') w
  cross join (select o.id from auth.oauth_clients o
               where o.client_name = 'Claude' and o.deleted_at is null and o.client_type::text = 'public'
                 and o.redirect_uris = 'https://claude.ai/api/mcp/auth_callback') c;

do $$
begin
  if (select count(*) from public.app_mcp_settings) <> 1
     or (select count(*) from public.app_mcp_settings s
          where not s.enabled and s.revoked_before is null and s.allowed_client_id is not null
            and s.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')) <> 1 then
    raise exception 'MCP_SETTINGS_ROW_RESULT_DIFFERS; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125180000', 'mcp_claude_settings_row', array['MCP Claude read M-6 settings row: one app_mcp_settings row for the sole operator workspace (the one with feature calls in app_operator_features) with enabled false and allowed_client_id read at apply time from the one non-deleted public auth.oauth_clients row named Claude whose redirect_uris is exactly the claude.ai MCP callback; stops if the operator workspace or that client is not exactly one, or a settings row already exists; no table, column, policy, grant, function or trigger change; no id written in the file']);
commit;
