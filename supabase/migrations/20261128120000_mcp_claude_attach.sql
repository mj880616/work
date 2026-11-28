begin;
-- MCP-Claude쓰기 ③ 파일 첨부(설계 docs/design/mcp-claude-write.md 11절). 사용자 결정 D-W2(2026-11-28 10:00): "지금 열기 / 상한도 높여".
-- 1판(20261128100000_mcp_claude_write) 위에 더한다. 무엇:
--   쓰기 기록 표 app_mcp_write_log에 칸 2개(files: 파일마다 drive_file_id·mime_type·size_bytes — 이름 없음 / file_bytes), 도구 이름 2개·동작 attach.
--   문지기 private.app_mcp_write_gate가 첨부 도구 2개도 받게(본문은 1판과 같고 이름 목록만 +2). 상한(1분 10번·하루 100번)을 같이 센다.
--   public.app_mcp_attach_check(도구, 입력)(INVOKER, authenticated): 위임 열쇠로 basket-files가 Drive에 손대기 전에 부른다 — 문지기·대상(내 노트·업데이트,
--     지우지 않음·가족/AI 제외/잠금 아님)·읽은 판·첨부 수(20)·하루 상한(30개·1 GB)·직접 올리기 8 MB. 통과하면 기록 1행(시도).
--   public.app_mcp_attach_commit(...)(DEFINER, service_role만): basket-files가 파일을 올린 뒤 같은 기록 행·같은 판일 때만 첨부 칸에 더하고 기록을 채운다.
--   public.app_mcp_attach_undone(기록 id)(INVOKER, 일반 로그인만): 화면이 첨부 [삭제] 길로 뗀 뒤 되돌림 표시.
--   1판 되돌리기 public.app_mcp_write_undo는 attach 행을 거절(본문은 1판과 같고 거절 한 줄만 더함).
-- 보안(AGENTS.md 3절): 기존 표·정책·권한은 넓히지 않는다. 새 anon·PUBLIC 실행권 없음. commit은 authenticated가 못 부른다(새 열쇠로 아무 Drive id를 넣는 길 없음).
--   작업공간·사용자 값은 입력으로 받지 않는다(확인은 열쇠로 문지기가, commit의 사용자 값은 basket-files가 Auth로 확인한 값).
-- 요청 전 함수(L1)의 허용 목록은 SQL Editor 파일 docs/ops/mcp-claude-attach-guard.*.sql로 넓힌다(app_mcp_attach_check 하나만).
-- 짝: docs/20261128120000_mcp_claude_attach.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261128120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261128100000' and name = 'mcp_claude_write') <> 1
     or to_regclass('public.app_mcp_write_log') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_mcp_write_gate(text)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_mcp_write_note(uuid,text,text,uuid,date,text,jsonb,integer,integer,timestamptz)') and prosecdef)
     or to_regprocedure('public.app_mcp_write_undo(uuid)') is null
     or to_regprocedure('private.app_mcp_w_text(jsonb,text,integer,boolean)') is null
     or to_regprocedure('private.app_mcp_w_version(jsonb)') is null
     or to_regprocedure('private.app_mcp_w_note_blocked(jsonb,boolean,jsonb)') is null
     or to_regprocedure('private.app_mcp_note_locks()') is null
     or to_regprocedure('private.app_mcp_uuid(text)') is null
     or pg_get_functiondef(to_regprocedure('private.app_mcp_write_gate(text)')) like '%web2_attach%'
     or pg_get_functiondef(to_regprocedure('public.app_mcp_write_undo(uuid)')) like '%attach%'
     or exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.app_mcp_write_log') and a.attname in ('files', 'file_bytes') and not a.attisdropped)
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname in ('app_mcp_attach_check', 'app_mcp_attach_commit', 'app_mcp_attach_undone'))
     or (select count(*) from pg_constraint where conrelid = 'public.app_mcp_write_log'::regclass and contype = 'c'
         and conname in ('app_mcp_write_log_tool_check', 'app_mcp_write_log_action_check')) <> 2
     or (select count(*) from pg_attribute a where a.attrelid = to_regclass('public.app_notes') and a.attname in ('attachments', 'kind', 'deleted_at', 'updated_at', 'workspace_id', 'metadata', 'ai_export_allowed') and not a.attisdropped) <> 7 then
    raise exception 'MCP_CLAUDE_ATTACH_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 기록 표: 도구 2개·동작 attach·파일 칸 ------------------------------------------------------------

alter table public.app_mcp_write_log drop constraint app_mcp_write_log_tool_check;
alter table public.app_mcp_write_log add constraint app_mcp_write_log_tool_check check (tool in ('web2_record_get', 'web2_note_create', 'web2_note_edit', 'web2_update_create', 'web2_update_edit',
    'web2_trash', 'web2_work_line_add', 'web2_org_record_add', 'web2_org_record_edit', 'web2_business_record_add', 'web2_business_record_edit',
    'web2_attach_file', 'web2_attach_drive_file'));
alter table public.app_mcp_write_log drop constraint app_mcp_write_log_action_check;
alter table public.app_mcp_write_log add constraint app_mcp_write_log_action_check check (action in ('read', 'create', 'edit', 'trash', 'append', 'attach'));
alter table public.app_mcp_write_log
  add column files jsonb,
  add column file_bytes bigint;
alter table public.app_mcp_write_log add constraint app_mcp_write_log_files_check check (
  (files is null) = (file_bytes is null)
  and (files is null or (action = 'attach' and pg_catalog.jsonb_typeof(files) = 'array' and pg_catalog.jsonb_array_length(files) between 1 and 5
       and pg_catalog.octet_length(files::text) <= 4000))
  and (file_bytes is null or file_bytes between 1 and 524288000));

-- 문지기: 1판과 같은 본문, 받는 도구 이름만 +2 -----------------------------------------------------

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
      'web2_trash', 'web2_work_line_add', 'web2_org_record_add', 'web2_org_record_edit', 'web2_business_record_add', 'web2_business_record_edit',
      'web2_attach_file', 'web2_attach_drive_file') then
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

-- 1판 되돌리기: 같은 본문 + attach 행 거절 한 줄 ---------------------------------------------------

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
  -- MCP-Claude쓰기 ③: 첨부 행은 글 되돌리기가 아니다(첨부 [삭제] 길 + app_mcp_attach_undone).
  if v_log.action = 'attach' then
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

-- 첨부 함수 3개 -----------------------------------------------------------------------------------

-- 첨부 확인(위임 열쇠, basket-files가 Drive에 손대기 전에 같은 열쇠로 부른다). 문지기·대상·판·첨부 수·하루 상한을 보고 기록 1행(시도)을 남긴다.
-- 입력은 basket-files가 만든다: 직접 올리기는 풀어 낸 파일의 이름·종류·크기, 드라이브 붙이기는 Drive 파일 id. 파일 내용은 받지 않는다.
create function public.app_mcp_attach_check(p_tool text, p_args jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_allowed text[];
  v_ws uuid;
  v_locks jsonb;
  v_kind text;
  v_id uuid;
  v_base timestamptz;
  v_note public.app_notes%rowtype;
  v_name text;
  v_mime text;
  v_drive text;
  v_size bigint := 0;
  v_files bigint;
  v_bytes bigint;
  v_log uuid;
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
begin
  if pg_catalog.jsonb_typeof(v_args) <> 'object' or pg_catalog.octet_length(v_args::text) > 4000 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_allowed := case p_tool
    when 'web2_attach_file' then array['kind', 'id', 'base_version', 'file_name', 'mime_type', 'size_bytes']
    when 'web2_attach_drive_file' then array['kind', 'id', 'base_version', 'drive_file_id']
  end;
  if v_allowed is null then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(v_args) k where k <> all (v_allowed))
     or exists (select 1 from pg_catalog.unnest(v_allowed) a where not (v_args ? a)) then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;

  v_ws := private.app_mcp_write_gate(p_tool);
  v_locks := coalesce(private.app_mcp_note_locks(), '{}'::jsonb);

  -- 대상: 노트·업데이트 둘만(가족 표·통화·텔레그램·원장·조직·사업 기록은 받는 칸이 없다).
  v_kind := private.app_mcp_w_text(v_args, 'kind', 20, false);
  if v_kind is null or v_kind not in ('note', 'update') then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'id', 36, false));
  v_base := private.app_mcp_w_version(v_args);
  if p_tool = 'web2_attach_file' then
    v_name := private.app_mcp_w_text(v_args, 'file_name', 255, false);
    v_mime := private.app_mcp_w_text(v_args, 'mime_type', 255, false);
    if v_name is null or v_mime is null or v_mime !~ '^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$'
       or pg_catalog.jsonb_typeof(v_args -> 'size_bytes') <> 'number' or (v_args ->> 'size_bytes') !~ '^[0-9]{1,10}$' then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    v_size := (v_args ->> 'size_bytes')::bigint;
    if v_size < 1 then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    if v_size > 8388608 then
      raise exception using errcode = '22023', message = 'TOO_LARGE';
    end if;
  else
    v_drive := private.app_mcp_w_text(v_args, 'drive_file_id', 255, false);
    if v_drive is null or v_drive !~ '^[A-Za-z0-9_-]{10,255}$' then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
  end if;

  select n.* into v_note from public.app_notes n
   where n.id = v_id and n.workspace_id = v_ws and n.deleted_at is null
     and n.kind = case v_kind when 'note' then 'note' else 'basket' end;
  if v_note.id is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if private.app_mcp_w_note_blocked(v_note.metadata, v_note.ai_export_allowed, v_locks) then
    raise exception using errcode = 'PT403', message = 'LOCKED';
  end if;
  if v_note.updated_at <> v_base then
    raise exception using errcode = '40001', message = 'CHANGED';
  end if;
  if pg_catalog.jsonb_typeof(v_note.attachments) <> 'array' or pg_catalog.jsonb_array_length(v_note.attachments) >= 20 then
    raise exception using errcode = '22023', message = 'TOO_MANY';
  end if;

  -- 하루(서울 날짜) 첨부 30개·합계 1 GB. 붙인 것은 파일 수로, 10분 안의 시도(아직 안 붙음)는 1개로 센다.
  select coalesce(pg_catalog.sum(case when l.files is null then 1 else pg_catalog.jsonb_array_length(l.files) end), 0),
         coalesce(pg_catalog.sum(l.file_bytes), 0)
    into v_files, v_bytes
    from public.app_mcp_write_log l
   where l.workspace_id = v_ws and l.action = 'attach' and l.called_at >= v_day_start
     and (l.files is not null or l.called_at > pg_catalog.now() - interval '10 minutes');
  if v_files >= 30 or v_bytes + v_size > 1073741824 then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED';
  end if;

  v_log := private.app_mcp_write_note(v_ws, p_tool, v_kind, v_id, null, 'attach', null, null, null, null);
  return pg_catalog.jsonb_build_object('log_id', v_log, 'kind', v_kind, 'note_kind', v_note.kind, 'id', v_id,
    'version', v_note.updated_at, 'attachments', pg_catalog.jsonb_array_length(v_note.attachments));
end
$$;
revoke all on function public.app_mcp_attach_check(text, jsonb) from public, anon, service_role;
grant execute on function public.app_mcp_attach_check(text, jsonb) to authenticated;

-- 첨부 저장(서버 키 전용 — basket-files가 파일을 올린 뒤에만 부른다). authenticated·anon 실행권 없음, L1 목록에도 없다.
-- 확인 때 남긴 기록 행(10분 안·아직 안 채움)과 같은 작업공간 owner·같은 판일 때만, 한 트랜잭션으로 첨부 칸에 더하고 기록을 채운다.
create function public.app_mcp_attach_commit(p_log_id uuid, p_user_id uuid, p_base timestamptz, p_file jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.app_mcp_write_log%rowtype;
  v_s public.app_mcp_settings%rowtype;
  v_note public.app_notes%rowtype;
  v_size bigint;
  v_bytes bigint;
  v_after timestamptz;
  v_att jsonb;
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
begin
  if p_log_id is null or p_user_id is null or p_base is null or pg_catalog.jsonb_typeof(p_file) is distinct from 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_file) k where k not in ('drive_file_id', 'file_name', 'mime_type', 'size_bytes'))
     or coalesce(p_file ->> 'drive_file_id', '') !~ '^[A-Za-z0-9_-]{1,255}$'
     or pg_catalog.jsonb_typeof(p_file -> 'file_name') is distinct from 'string'
     or pg_catalog.char_length(p_file ->> 'file_name') not between 1 and 255
     or coalesce(p_file ->> 'mime_type', '') !~ '^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$'
     or pg_catalog.jsonb_typeof(p_file -> 'size_bytes') is distinct from 'number' or (p_file ->> 'size_bytes') !~ '^[0-9]{1,10}$' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_size := (p_file ->> 'size_bytes')::bigint;
  if v_size < 1 or v_size > 104857600 then
    raise exception using errcode = '22023', message = 'TOO_LARGE';
  end if;

  select l.* into v_log from public.app_mcp_write_log l where l.id = p_log_id for update;
  if v_log.id is null or v_log.action <> 'attach' or v_log.files is not null or v_log.after_version is not null
     or v_log.undone_at is not null or v_log.called_at < pg_catalog.now() - interval '10 minutes' then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if v_log.tool = 'web2_attach_file' and v_size > 8388608 then
    raise exception using errcode = '22023', message = 'TOO_LARGE';
  end if;
  -- 부른 사람(basket-files가 Auth로 확인한 사용자)이 그 기록 작업공간의 owner, 허용·스위치가 아직 켜져 있음.
  if not exists (select 1 from public.app_workspace_members m
                  where m.workspace_id = v_log.workspace_id and m.user_id = p_user_id and m.role = 'owner')
     or not private.app_workspace_has_feature(v_log.workspace_id, 'mcp_write') then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  select s.* into v_s from public.app_mcp_settings s where s.workspace_id = v_log.workspace_id for update;
  if v_s.workspace_id is null or v_s.enabled is not true
     or (v_s.revoked_before is not null and v_s.revoked_before >= v_log.called_at) then
    raise exception using errcode = 'PT403', message = 'DISCONNECTED';
  end if;
  if v_s.write_enabled is not true then
    raise exception using errcode = 'PT403', message = 'WRITE_OFF';
  end if;
  select coalesce(pg_catalog.sum(l.file_bytes), 0) into v_bytes from public.app_mcp_write_log l
   where l.workspace_id = v_log.workspace_id and l.action = 'attach' and l.called_at >= v_day_start and l.id <> v_log.id;
  if v_bytes + v_size > 1073741824 then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED';
  end if;

  select n.* into v_note from public.app_notes n
   where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id and n.deleted_at is null
     and n.kind = case v_log.kind when 'note' then 'note' else 'basket' end
   for update;
  if v_note.id is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if v_note.updated_at <> p_base then
    raise exception using errcode = '40001', message = 'CHANGED';
  end if;
  if pg_catalog.jsonb_typeof(v_note.attachments) <> 'array' or pg_catalog.jsonb_array_length(v_note.attachments) >= 20 then
    raise exception using errcode = '22023', message = 'TOO_MANY';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_note.attachments) a where a ->> 'drive_file_id' = p_file ->> 'drive_file_id') then
    raise exception using errcode = '40001', message = 'CHANGED';
  end if;
  v_att := v_note.attachments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'drive_file_id', p_file ->> 'drive_file_id', 'file_name', p_file ->> 'file_name', 'mime_type', p_file ->> 'mime_type', 'size_bytes', v_size));
  update public.app_notes n set attachments = v_att, updated_at = pg_catalog.clock_timestamp()
   where n.id = v_note.id and n.workspace_id = v_log.workspace_id and n.updated_at = p_base and n.deleted_at is null
   returning n.updated_at into v_after;
  if v_after is null then
    raise exception using errcode = '40001', message = 'CHANGED';
  end if;
  -- 기록에는 이름 없이 id·종류·크기만.
  update public.app_mcp_write_log l
     set files = pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('drive_file_id', p_file ->> 'drive_file_id', 'mime_type', p_file ->> 'mime_type', 'size_bytes', v_size)),
         file_bytes = v_size, after_version = v_after, chars_before = null, chars_after = null
   where l.id = v_log.id;
  return pg_catalog.jsonb_build_object('ok', true, 'kind', v_log.kind, 'id', v_note.id, 'version', v_after, 'action', 'attach', 'attachments', v_att);
end
$$;
revoke all on function public.app_mcp_attach_commit(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.app_mcp_attach_commit(uuid, uuid, timestamptz, jsonb) to service_role;

-- 첨부 되돌림 표시(화면 전용, 위임 열쇠 거절). 화면이 먼저 첨부 [삭제] 길(document-actions trash-file)로 파일을 떼고 휴지통에 보낸 뒤 부른다.
-- 그 파일이 그 노트에 아직 붙어 있으면 거절(STILL_ATTACHED). 노트를 못 읽으면(남의 것·휴지통) NOT_FOUND.
create function public.app_mcp_attach_undone(p_log_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.app_mcp_write_log%rowtype;
  v_att jsonb;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()) ->> 'client_id', '') <> '' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  select l.* into v_log from public.app_mcp_write_log l
   where l.id = p_log_id and l.action = 'attach' and l.files is not null and l.undone_at is null
   for update;
  if v_log.id is null or not private.app_is_workspace_owner(v_log.workspace_id) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  select n.attachments into v_att from public.app_notes n
   where n.id = v_log.target_id and n.workspace_id = v_log.workspace_id;
  if v_att is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_log.files) f
              join pg_catalog.jsonb_array_elements(v_att) a on a ->> 'drive_file_id' = f ->> 'drive_file_id') then
    raise exception using errcode = '40001', message = 'STILL_ATTACHED';
  end if;
  update public.app_mcp_write_log l set undone_at = pg_catalog.now() where l.id = v_log.id;
  return pg_catalog.jsonb_build_object('ok', true, 'kind', v_log.kind, 'id', v_log.target_id);
end
$$;
revoke all on function public.app_mcp_attach_undone(uuid) from public, anon, service_role;
grant execute on function public.app_mcp_attach_undone(uuid) to authenticated;

-- 사후 확인: commit은 서버 키 전용, 확인은 authenticated만, 새 함수에 anon·PUBLIC 실행권 없음. 다르면 전체 취소.
do $$
begin
  if has_function_privilege('authenticated', 'public.app_mcp_attach_commit(uuid,uuid,timestamptz,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_mcp_attach_commit(uuid,uuid,timestamptz,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.app_mcp_attach_commit(uuid,uuid,timestamptz,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_mcp_attach_check(text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_mcp_attach_check(text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.app_mcp_attach_check(text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_mcp_attach_undone(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_mcp_attach_undone(uuid)', 'execute')
     or has_table_privilege('service_role', 'public.app_mcp_write_log', 'select,insert,update,delete')
     or pg_get_functiondef(to_regprocedure('private.app_mcp_write_gate(text)')) not like '%web2_attach_drive_file%' then
    raise exception 'MCP_CLAUDE_ATTACH_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261128120000', 'mcp_claude_attach', array['MCP-Claude쓰기 ③: app_mcp_write_log files/file_bytes columns, attach tool names and action; write gate accepts two attach tools; public app_mcp_attach_check (invoker, authenticated), app_mcp_attach_commit (definer, service_role only), app_mcp_attach_undone (invoker, authenticated); app_mcp_write_undo refuses attach rows']);
commit;
