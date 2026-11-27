begin;
-- 20261127120000_mcp_claude_read_areas의 짝 되돌리기. 새 읽기 함수 10개·도우미 7개를 지우고, 문지기를 2판 본문(20261120090000 원문)으로 되살리고,
-- 기록 표 도구 이름 검사를 7개로, 설정 표 영역 칸 5개를 지우고, 이번 기록 1행을 지운다. 2판 읽기 함수·다른 표·정책·자료는 건드리지 않는다.
-- 순서: ① Web2 스위치 끄기(또는 영역 끄기) ② docs/ops/mcp-claude-read-guard-areas.rollback.sql(요청 전 함수 허용 목록 7개로) ③ 이 파일.
-- 새 도구의 읽은 기록(도구 이름·건수뿐, 내용 없음) 행이 있으면 멈춘다: CC가 숫자만 확인하고 아래 주석의 delete를 따로 실행한 뒤 다시 실행.
--   delete from public.app_mcp_read_log where tool in ('web2_day_list', 'web2_day_get', 'web2_calls_list', 'web2_call_get', 'web2_recordings_list', 'web2_recording_get', 'web2_basket_search', 'web2_basket_get', 'web2_family_list', 'web2_family_get');
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 함수·칸 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127120000' and name = 'mcp_claude_read_areas') <> 1 then
    raise exception 'MCP_CLAUDE_READ_AREAS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if to_regprocedure('public.app_mcp_pre_request()') is not null
     and pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) like '%day\_list%' then
    raise exception 'MCP_CLAUDE_READ_AREAS_ROLLBACK_BLOCKED: undo docs/ops/mcp-claude-read-guard-areas first';
  end if;
  if exists (select 1 from public.app_mcp_read_log where tool in ('web2_day_list', 'web2_day_get', 'web2_calls_list', 'web2_call_get', 'web2_recordings_list', 'web2_recording_get', 'web2_basket_search', 'web2_basket_get', 'web2_family_list', 'web2_family_get')) then
    raise exception 'MCP_CLAUDE_READ_AREAS_ROLLBACK_BLOCKED: log rows of new tools exist';
  end if;
end
$$;

drop function public.app_mcp_family_get(text, integer);
drop function public.app_mcp_family_list(text, integer);
drop function public.app_mcp_basket_get(text, integer);
drop function public.app_mcp_basket_search(text, date, date, integer);
drop function public.app_mcp_recording_get(text, integer);
drop function public.app_mcp_recordings_list(date, date, text, integer);
drop function public.app_mcp_call_get(text, integer);
drop function public.app_mcp_calls_list(date, date, text, text, integer);
drop function public.app_mcp_day_get(date, integer);
drop function public.app_mcp_day_list(date, date, text, integer);
drop function private.app_mcp_period(date, date, integer);
drop function private.app_mcp_uuid(text);
drop function private.app_mcp_hit(text, text[]);
drop function private.app_mcp_words(text);
drop function private.app_mcp_page(text, integer);
drop function private.app_mcp_text(text, integer);

-- 문지기 2판 본문(20261120090000_mcp_claude_read 원문 그대로).
create or replace function private.app_mcp_gate(p_tool text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_client text;
  v_session text;
  v_owned integer;
  v_ws uuid;
  v_enabled boolean;
  v_allowed text;
  v_revoked timestamptz;
  v_started timestamptz;
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
begin
  v_client := coalesce(v_claims ->> 'client_id', '');
  v_session := coalesce(v_claims ->> 'session_id', '');
  if p_tool is null or p_tool not in ('web2_org_status', 'web2_business_reports', 'web2_project_status',
      'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where') then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  -- 1. 로그인 + OAuth 클라이언트 열쇠(일반 Web2 로그인 열쇠는 client_id가 없어 거절).
  if v_uid is null or v_client = '' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  -- 2. 부른 사람이 owner인 작업공간이 정확히 하나. 작업공간은 이 결과만 쓴다.
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(m.workspace_id))[1] into v_owned, v_ws
    from public.app_workspace_members m
   where m.user_id = v_uid and m.role = 'owner';
  if v_owned <> 1 or v_ws is null or not private.app_is_workspace_owner(v_ws) then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  -- 1(이어서). 허용 클라이언트와 같은지. 설정 행을 잠가 같은 작업공간의 동시 호출을 한 줄로 세운다(상한 셈이 겹치지 않게).
  select s.enabled, s.allowed_client_id, s.revoked_before into v_enabled, v_allowed, v_revoked
    from public.app_mcp_settings s
   where s.workspace_id = v_ws
     for update;
  if not found or v_allowed is null or v_allowed <> v_client then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  -- 3. 스위치.
  if v_enabled is not true then
    raise exception using errcode = 'PT403', message = 'DISCONNECTED';
  end if;
  -- 4. [모든 연결 끊기]: 열쇠의 로그인 세션이 그 시각 뒤에 만들어졌어야 한다.
  if v_revoked is not null then
    if v_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'PT403', message = 'DISCONNECTED';
    end if;
    select se.created_at into v_started
      from auth.sessions se
     where se.id = v_session::uuid and se.user_id = v_uid;
    if v_started is null or v_started <= v_revoked then
      raise exception using errcode = 'PT403', message = 'DISCONNECTED';
    end if;
  end if;
  -- 5. 상한: 최근 1분 20번 미만, 오늘(KST) 300번 미만(통과한 호출만 센다).
  if (select pg_catalog.count(*) from public.app_mcp_read_log l
       where l.workspace_id = v_ws and l.status = 'ok' and l.called_at > pg_catalog.now() - interval '1 minute') >= 20
     or (select pg_catalog.count(*) from public.app_mcp_read_log l
       where l.workspace_id = v_ws and l.status = 'ok' and l.called_at >= v_day_start) >= 300 then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED';
  end if;
  -- 6. 기록 1행(실패하면 읽기도 실패).
  insert into public.app_mcp_read_log(workspace_id, tool, status) values (v_ws, p_tool, 'ok');
  return v_ws;
end
$$;
revoke all on function private.app_mcp_gate(text) from public, anon, service_role;
grant execute on function private.app_mcp_gate(text) to authenticated;
drop function private.app_mcp_locked_areas();

alter table public.app_mcp_read_log drop constraint app_mcp_read_log_tool_check;
alter table public.app_mcp_read_log add constraint app_mcp_read_log_tool_check check (tool in ('web2_org_status', 'web2_business_reports', 'web2_project_status',
    'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where'));
revoke update (area_diary, area_calls, area_recordings, area_basket, area_family) on table public.app_mcp_settings from authenticated;
alter table public.app_mcp_settings
  drop column area_diary,
  drop column area_calls,
  drop column area_recordings,
  drop column area_basket,
  drop column area_family;

delete from supabase_migrations.schema_migrations
  where version = '20261127120000' and name = 'mcp_claude_read_areas';
commit;
