begin;
-- 20261128120000_mcp_claude_attach의 짝 되돌리기. 첨부 함수 3개를 지우고, 문지기·되돌리기 함수를 1판 본문으로, 쓰기 기록 표의 칸·검사를 1판 모양으로 돌린다.
-- 이미 노트·업데이트에 붙은 첨부(파일)는 그대로 남는다(사용자 자료). Claude 첨부 기록 행(action = 'attach')은 1판 검사에 맞지 않아 지운다 — 필요하면 먼저 화면에서 되돌린다.
-- 순서: ① Web2 쓰기 스위치 끄기 ② docs/ops/mcp-claude-attach-guard.rollback.sql(요청 전 함수 허용 목록 19개로) ③ 이 파일.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 함수·칸 삭제와 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261128120000' and name = 'mcp_claude_attach') <> 1 then
    raise exception 'MCP_CLAUDE_ATTACH_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if to_regprocedure('public.app_mcp_pre_request()') is not null
     and pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) like '%attach\_check%' then
    raise exception 'MCP_CLAUDE_ATTACH_ROLLBACK_BLOCKED: undo docs/ops/mcp-claude-attach-guard first';
  end if;
end
$$;

drop function public.app_mcp_attach_undone(uuid);
drop function public.app_mcp_attach_commit(uuid, uuid, timestamptz, jsonb);
drop function public.app_mcp_attach_check(text, jsonb);

create or replace function public.app_mcp_write_undo(p_log_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.app_mcp_write_log%rowtype;
  v_vals jsonb;
  v_n integer := 0;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()) ->> 'client_id', '') <> '' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  select l.* into v_log from public.app_mcp_write_log l
   where l.id = p_log_id and l.action <> 'read' and l.undone_at is null
   for update;
  if v_log.id is null or not private.app_is_workspace_owner(v_log.workspace_id) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  select b.vals into v_vals from public.app_mcp_write_before b where b.log_id = v_log.id;
  if v_log.action in ('edit', 'append') and v_vals is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_log.kind in ('note', 'update') then
    if v_log.action = 'create' then
      -- 만든 노트·업데이트는 휴지통으로(트리거가 deleted_at만 채움).
      delete from public.app_notes n
       where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id and n.updated_at = v_log.after_version;
      if exists (select 1 from public.app_notes n where n.id = v_log.target_id) then
        raise exception using errcode = '40001', message = 'CHANGED';
      end if;
      v_n := 1;
    elsif v_log.action = 'trash' then
      perform public.app_trash_restore('note', v_log.target_id);
      v_n := 1;
    else
      update public.app_notes n
         set title = case when n.kind = 'note' then v_vals ->> 'title' else n.title end,
             raw_text = v_vals ->> 'raw_text',
             doc = case when pg_catalog.jsonb_typeof(v_vals -> 'doc') = 'object' then v_vals -> 'doc' end,
             metadata = case when n.kind = 'note' then
               pg_catalog.jsonb_strip_nulls((n.metadata - 'folder_id' - 'folder')
                 || pg_catalog.jsonb_build_object('folder_id', v_vals -> 'folder_id', 'folder', v_vals -> 'folder'))
               || (n.metadata - 'folder_id' - 'folder')
               else n.metadata end,
             updated_at = pg_catalog.clock_timestamp()
       where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id and n.updated_at = v_log.after_version;
      get diagnostics v_n = row_count;
    end if;
  elsif v_log.kind = 'work' then
    if v_vals -> 'raw_text' is null or pg_catalog.jsonb_typeof(v_vals -> 'raw_text') = 'null' then
      delete from public.app_notes n
       where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id and n.kind = 'work' and n.updated_at = v_log.after_version;
    else
      update public.app_notes n set raw_text = v_vals ->> 'raw_text', updated_at = pg_catalog.clock_timestamp()
       where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id and n.kind = 'work' and n.updated_at = v_log.after_version;
    end if;
    get diagnostics v_n = row_count;
  elsif v_log.kind = 'org_record' then
    if v_log.action = 'create' then
      delete from public.app_suborganization_updates u
       where u.id = v_log.target_id and u.updated_at = v_log.after_version;
    else
      update public.app_suborganization_updates u
         set raw_text = v_vals ->> 'raw_text',
             doc = case when pg_catalog.jsonb_typeof(v_vals -> 'doc') = 'object' then v_vals -> 'doc' end,
             one_line = v_vals ->> 'one_line',
             updated_at = pg_catalog.clock_timestamp()
       where u.id = v_log.target_id and u.updated_at = v_log.after_version;
    end if;
    get diagnostics v_n = row_count;
  elsif v_log.kind = 'business_record' then
    if v_log.action = 'create' then
      delete from public.app_business_records r
       where r.id = v_log.target_id and r.workspace_id = v_log.workspace_id and r.updated_at = v_log.after_version;
    else
      update public.app_business_records r set body = v_vals ->> 'body'
       where r.id = v_log.target_id and r.workspace_id = v_log.workspace_id and r.updated_at = v_log.after_version;
    end if;
    get diagnostics v_n = row_count;
  end if;

  if v_n <> 1 then
    raise exception using errcode = '40001', message = 'CHANGED';
  end if;
  update public.app_mcp_write_log l set undone_at = pg_catalog.now() where l.id = v_log.id;
  return pg_catalog.jsonb_build_object('ok', true, 'kind', v_log.kind, 'id', v_log.target_id);
end
$$;
revoke all on function public.app_mcp_write_undo(uuid) from public, anon, service_role;
grant execute on function public.app_mcp_write_undo(uuid) to authenticated;

create or replace function private.app_mcp_write_gate(p_tool text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c jsonb;
  v_ws uuid;
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
begin
  if p_tool is null or p_tool not in ('web2_record_get', 'web2_note_create', 'web2_note_edit', 'web2_update_create', 'web2_update_edit',
      'web2_trash', 'web2_work_line_add', 'web2_org_record_add', 'web2_org_record_edit', 'web2_business_record_add', 'web2_business_record_edit') then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  v_c := private.app_mcp_write_check(true);
  if v_c ->> 'status' <> 'ok' then
    raise exception using errcode = 'PT403', message = v_c ->> 'status';
  end if;
  v_ws := (v_c ->> 'workspace_id')::uuid;
  if (select pg_catalog.count(*) from public.app_mcp_write_log l
       where l.workspace_id = v_ws and l.called_at > pg_catalog.now() - interval '1 minute') >= 10
     or (select pg_catalog.count(*) from public.app_mcp_write_log l
       where l.workspace_id = v_ws and l.called_at >= v_day_start) >= 100 then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED';
  end if;
  return v_ws;
end
$$;
revoke all on function private.app_mcp_write_gate(text) from public, anon, service_role;
grant execute on function private.app_mcp_write_gate(text) to authenticated;

delete from public.app_mcp_write_log where action = 'attach' or tool in ('web2_attach_file', 'web2_attach_drive_file');
alter table public.app_mcp_write_log drop constraint app_mcp_write_log_files_check;
alter table public.app_mcp_write_log drop column files, drop column file_bytes;
alter table public.app_mcp_write_log drop constraint app_mcp_write_log_action_check;
alter table public.app_mcp_write_log add constraint app_mcp_write_log_action_check check (action in ('read', 'create', 'edit', 'trash', 'append'));
alter table public.app_mcp_write_log drop constraint app_mcp_write_log_tool_check;
alter table public.app_mcp_write_log add constraint app_mcp_write_log_tool_check check (tool in ('web2_record_get', 'web2_note_create', 'web2_note_edit', 'web2_update_create', 'web2_update_edit',
    'web2_trash', 'web2_work_line_add', 'web2_org_record_add', 'web2_org_record_edit', 'web2_business_record_add', 'web2_business_record_edit'));

delete from supabase_migrations.schema_migrations where version = '20261128120000' and name = 'mcp_claude_attach';
commit;
