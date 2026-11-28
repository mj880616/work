begin;
-- MCP-Claude쓰기 1판(설계 docs/design/mcp-claude-write.md). 사용자 결정 D-W1(2026-11-28): Claude 연결로 Web2 기록을 쓰게 하되 사용자 본인 작업공간만.
--
-- 무엇:
--   운영자 기능 키에 'mcp_write'를 더하고(검사 지우고 같은 이름으로 다시 만듦), 허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만
--     그 작업공간에 1행(고정 id·이름 없음 — photo_content와 같은 방식). 다른 작업공간은 쓰기 도구가 보이지도 불리지도 않는다.
--   설정 표 app_mcp_settings에 쓰기 스위치 write_enabled(기본 꺼짐) — 화면(일반 로그인)만 고친다(기존 고치기 정책이 위임 열쇠를 거절).
--   새 표 app_mcp_write_log(쓰기 기록: 언제·도구·종류·대상 id·동작·글자 수·쓴 뒤 판·되돌린 때. 내용 없음),
--     app_mcp_write_before(고치기 전 칸 값 — 되돌리기용, 30일 뒤 지움). 둘 다 owner 읽기만.
--   문지기 private.app_mcp_write_check/app_mcp_write_gate(DEFINER): 읽기 문지기 검사 1~4 + 운영자 기능 mcp_write + 쓰기 스위치 + 상한(1분 10번·하루 100번).
--   쓰기 함수 public.app_mcp_write(도구, 입력)(INVOKER) 하나가 도구 11개를 처리: 고치기 전 읽기, 노트·업데이트 만들기·고치기, 휴지통 보내기,
--     업무일지 한 줄, 담당조직 기록·사업 기록 더하기·고치기. public.app_mcp_write_tools()는 쓰기 도구를 보여 줄지(참/거짓)만.
--   되돌리기 public.app_mcp_write_undo(기록 id)(INVOKER): 화면 전용 — 위임 열쇠는 거절. 그사이 사용자가 또 고쳤으면 거절.
-- 보안(AGENTS.md 3절):
--   - 쓰기·되돌리기 함수는 SECURITY INVOKER + search_path ''. 기존 owner RLS·휴지통 restrictive 정책·출처 검사 트리거가 그대로 걸린다.
--     작업공간·사용자 값을 입력으로 받지 않는다(문지기가 열쇠로 정함). 한 호출에 한 건만 바꾼다.
--   - 쓰지 않는 것: 일기·가족 기록(가족 표·가족 노트)·AI 재료에서 뺀 노트·잠근 폴더·앱 잠금 '일기'일 때 업무일지, 통화·텔레그램·바깥 수집, 원장,
--     할 일·일정(Google 원본), 다른 작업공간·공유물. 지우기는 휴지통(노트·업데이트)만 — 완전 삭제 없음.
--   - 새 표: RLS 켬, owner 정책(authenticated만), PUBLIC·anon·service_role 권한 없음. 새 anon·PUBLIC 실행권 없음.
--   - 기존 표·정책·함수·자료는 바꾸지 않는다(운영자 기능 키 검사·설정 표 새 칸 1개·허용 행 1행만).
-- 요청 전 함수(L1)의 허용 이름 목록은 SQL Editor 파일 docs/ops/mcp-claude-write-guard.*.sql로 넓힌다(app_mcp_write·app_mcp_write_tools 둘만).
-- 짝: docs/20261128100000_mcp_claude_write.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261128100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261127120000' and name = 'mcp_claude_read_areas') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261126190000' and name = 'photo_content_feature') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_mcp_gate(text)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_mcp_locked_areas()') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or to_regprocedure('private.app_mcp_note_locks()') is null
     or to_regprocedure('private.app_mcp_arg(text,integer)') is null
     or to_regprocedure('private.app_mcp_page(text,integer)') is null
     or to_regprocedure('private.app_mcp_uuid(text)') is null
     or to_regprocedure('public.app_trash_restore(text,uuid)') is null
     or to_regclass('public.app_mcp_write_log') is not null
     or to_regclass('public.app_mcp_write_before') is not null
     or exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.app_mcp_settings') and a.attname = 'write_enabled' and not a.attisdropped)
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname in ('app_mcp_write', 'app_mcp_write_tools', 'app_mcp_write_undo', 'app_mcp_write_check', 'app_mcp_write_gate', 'app_mcp_write_note', 'app_mcp_w_diary_locked', 'app_mcp_w_text', 'app_mcp_w_version', 'app_mcp_w_day', 'app_mcp_w_note_blocked'))
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''photo_content''' and pg_get_constraintdef(oid) !~ '''mcp_write''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content'))
     or (select count(*) from (values
          ('app_notes', 'kind'), ('app_notes', 'title'), ('app_notes', 'raw_text'), ('app_notes', 'doc'), ('app_notes', 'metadata'), ('app_notes', 'journal_day'),
          ('app_notes', 'ai_export_allowed'), ('app_notes', 'deleted_at'), ('app_notes', 'occurred_at'), ('app_notes', 'updated_at'), ('app_notes', 'workspace_id'),
          ('app_note_folders', 'workspace_id'), ('app_note_folders', 'name'),
          ('app_suborganizations', 'workspace_id'), ('app_suborganizations', 'name'), ('app_suborganizations', 'deleted_at'),
          ('app_suborganization_updates', 'organization_id'), ('app_suborganization_updates', 'raw_text'), ('app_suborganization_updates', 'doc'),
          ('app_suborganization_updates', 'one_line'), ('app_suborganization_updates', 'occurred_at'), ('app_suborganization_updates', 'created_by'),
          ('app_suborganization_updates', 'created_at'), ('app_suborganization_updates', 'updated_at'),
          ('app_spaces', 'workspace_id'), ('app_spaces', 'name'), ('app_spaces', 'deleted_at'),
          ('app_business_records', 'workspace_id'), ('app_business_records', 'space_id'), ('app_business_records', 'day'), ('app_business_records', 'body'),
          ('app_business_records', 'source_kind'), ('app_business_records', 'updated_at')) v(t, c)
          join pg_attribute a on a.attrelid = to_regclass('public.' || v.t) and a.attname = v.c and not a.attisdropped) <> 33 then
    raise exception 'MCP_CLAUDE_WRITE_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'MCP_CLAUDE_WRITE_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

-- 운영자 기능 키 + 허용 행(통화가 허용된 작업공간 하나) -------------------------------------------------------

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content', 'mcp_write'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'mcp_write' from public.app_operator_features f where f.feature = 'calls';

-- 설정 칸·새 표 --------------------------------------------------------------------------------------

alter table public.app_mcp_settings
  add column write_enabled boolean not null default false;
grant update (write_enabled) on table public.app_mcp_settings to authenticated;

create table public.app_mcp_write_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  called_at timestamptz not null default now(),
  tool text not null,
  kind text not null,
  target_id uuid,
  target_day date,
  action text not null,
  chars_before integer,
  chars_after integer,
  after_version timestamptz,
  undone_at timestamptz,
  constraint app_mcp_write_log_tool_check check (tool in ('web2_record_get', 'web2_note_create', 'web2_note_edit', 'web2_update_create', 'web2_update_edit',
    'web2_trash', 'web2_work_line_add', 'web2_org_record_add', 'web2_org_record_edit', 'web2_business_record_add', 'web2_business_record_edit')),
  constraint app_mcp_write_log_kind_check check (kind in ('note', 'update', 'work', 'org_record', 'business_record')),
  constraint app_mcp_write_log_action_check check (action in ('read', 'create', 'edit', 'trash', 'append')),
  constraint app_mcp_write_log_counts_check check (
    (chars_before is null or chars_before between 0 and 1000000) and (chars_after is null or chars_after between 0 and 1000000)),
  constraint app_mcp_write_log_undo_check check (undone_at is null or action <> 'read')
);
create index app_mcp_write_log_scope_idx on public.app_mcp_write_log(workspace_id, called_at desc);

create table public.app_mcp_write_before (
  log_id uuid primary key references public.app_mcp_write_log(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  vals jsonb not null,
  constraint app_mcp_write_before_vals_check check (pg_catalog.jsonb_typeof(vals) = 'object' and pg_catalog.octet_length(vals::text) <= 2200000)
);
create index app_mcp_write_before_scope_idx on public.app_mcp_write_before(workspace_id, created_at);

alter table public.app_mcp_write_log enable row level security;
alter table public.app_mcp_write_before enable row level security;
revoke all on table public.app_mcp_write_log from public, anon, authenticated, service_role;
revoke all on table public.app_mcp_write_before from public, anon, authenticated, service_role;
grant select on table public.app_mcp_write_log to authenticated;
grant update (undone_at) on table public.app_mcp_write_log to authenticated;
grant select on table public.app_mcp_write_before to authenticated;

create policy app_mcp_write_log_owner_select on public.app_mcp_write_log for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
-- 되돌린 표시는 화면(일반 로그인)만. 위임 열쇠로는 못 고친다.
create policy app_mcp_write_log_owner_update on public.app_mcp_write_log for update to authenticated
  using (private.app_is_workspace_owner(workspace_id) and coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  with check (private.app_is_workspace_owner(workspace_id) and coalesce((select auth.jwt()) ->> 'client_id', '') = '');
-- 되돌리기 자료는 화면(일반 로그인)만 읽는다(되돌리기 함수가 INVOKER로 읽음).
create policy app_mcp_write_before_owner_select on public.app_mcp_write_before for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and coalesce((select auth.jwt()) ->> 'client_id', '') = '');

-- private 도우미 -------------------------------------------------------------------------------------

-- 허용 판정 하나(문지기·목록이 같이 씀). 'ok' 또는 거절 코드와 작업공간. p_lock이면 설정 행을 잠가 같은 작업공간의 쓰기를 한 줄로 세운다.
create function private.app_mcp_write_check(p_lock boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_client text := coalesce(v_claims ->> 'client_id', '');
  v_session text := coalesce(v_claims ->> 'session_id', '');
  v_owned integer;
  v_ws uuid;
  v_s public.app_mcp_settings%rowtype;
  v_started timestamptz;
begin
  -- 1. 로그인 + OAuth 클라이언트 열쇠(일반 로그인 열쇠는 client_id가 없어 거절).
  if v_uid is null or v_client = '' then
    return pg_catalog.jsonb_build_object('status', 'NOT_ALLOWED');
  end if;
  -- 2. 부른 사람이 owner인 작업공간이 정확히 하나.
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(m.workspace_id))[1] into v_owned, v_ws
    from public.app_workspace_members m
   where m.user_id = v_uid and m.role = 'owner';
  if v_owned <> 1 or v_ws is null or not private.app_is_workspace_owner(v_ws) then
    return pg_catalog.jsonb_build_object('status', 'NOT_ALLOWED');
  end if;
  if p_lock then
    select s.* into v_s from public.app_mcp_settings s where s.workspace_id = v_ws for update;
  else
    select s.* into v_s from public.app_mcp_settings s where s.workspace_id = v_ws;
  end if;
  -- 허용 클라이언트·운영자 기능(SQL로만 넣는 허용 표).
  if v_s.workspace_id is null or v_s.allowed_client_id is null or v_s.allowed_client_id <> v_client
     or not private.app_workspace_has_feature(v_ws, 'mcp_write') then
    return pg_catalog.jsonb_build_object('status', 'NOT_ALLOWED');
  end if;
  -- 3. 연결 스위치. 4. [모든 연결 끊기].
  if v_s.enabled is not true then
    return pg_catalog.jsonb_build_object('status', 'DISCONNECTED');
  end if;
  if v_s.revoked_before is not null then
    if v_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return pg_catalog.jsonb_build_object('status', 'DISCONNECTED');
    end if;
    select se.created_at into v_started from auth.sessions se where se.id = v_session::uuid and se.user_id = v_uid;
    if v_started is null or v_started <= v_s.revoked_before then
      return pg_catalog.jsonb_build_object('status', 'DISCONNECTED');
    end if;
  end if;
  -- 쓰기 스위치(화면, 기본 꺼짐).
  if v_s.write_enabled is not true then
    return pg_catalog.jsonb_build_object('status', 'WRITE_OFF');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'workspace_id', v_ws);
end
$$;
revoke all on function private.app_mcp_write_check(boolean) from public, anon, service_role;
grant execute on function private.app_mcp_write_check(boolean) to authenticated;

-- 쓰기 문지기: 판정 + 상한(최근 1분 10번 미만, 오늘(KST) 100번 미만 — 쓰기 묶음 도구 전체, 기록된 호출만 센다). 통과하면 작업공간.
create function private.app_mcp_write_gate(p_tool text)
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

-- 쓰기 기록 1행(+ 고치기 전 값). 위임 열쇠로 부른 owner 작업공간에만. 30일 지난 되돌리기 자료는 지운다. 실패하면 쓰기도 실패.
create function private.app_mcp_write_note(p_ws uuid, p_tool text, p_kind text, p_target uuid, p_day date, p_action text,
  p_before jsonb, p_chars_before integer, p_chars_after integer, p_after timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce((select auth.jwt()) ->> 'client_id', '') = '' or p_ws is null or not private.app_is_workspace_owner(p_ws) then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  insert into public.app_mcp_write_log(workspace_id, tool, kind, target_id, target_day, action, chars_before, chars_after, after_version)
  values (p_ws, p_tool, p_kind, p_target, p_day, p_action,
          least(p_chars_before, 1000000), least(p_chars_after, 1000000), p_after)
  returning id into v_id;
  if p_before is not null then
    insert into public.app_mcp_write_before(log_id, workspace_id, vals) values (v_id, p_ws, p_before);
  end if;
  delete from public.app_mcp_write_before b where b.workspace_id = p_ws and b.created_at < pg_catalog.now() - interval '30 days';
  return v_id;
end
$$;
revoke all on function private.app_mcp_write_note(uuid, text, text, uuid, date, text, jsonb, integer, integer, timestamptz) from public, anon, service_role;
grant execute on function private.app_mcp_write_note(uuid, text, text, uuid, date, text, jsonb, integer, integer, timestamptz) to authenticated;

-- 앱 잠금에 '일기'가 있나(업무일지 줄도 하루 기록이라 같이 막음). 잠금 표는 API 역할에 닫혀 있어 DEFINER로 읽기 3판 도우미를 부른다.
create function private.app_mcp_w_diary_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select 'diary' = any (private.app_mcp_locked_areas())
$$;
revoke all on function private.app_mcp_w_diary_locked() from public, anon, service_role;
grant execute on function private.app_mcp_w_diary_locked() to authenticated;

-- 입력 칸 읽기: 문자열만, 앞뒤 빈칸 정리, 길이 상한, 줄바꿈 허용 여부. 빈 글은 null. 다른 제어 문자는 거절.
create function private.app_mcp_w_text(p_args jsonb, p_key text, p_max integer, p_lines boolean)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text;
begin
  if p_args is null or not (p_args ? p_key) then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(p_args -> p_key) <> 'string' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v := pg_catalog.replace(p_args ->> p_key, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));
  v := nullif(pg_catalog.btrim(v, E' \n\t'), '');
  if v is not null and (pg_catalog.char_length(v) > p_max
      or v ~ '[\x01-\x08\x0b-\x1f\x7f]'
      or (not p_lines and v ~ '[\n\t]')) then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return v;
end
$$;
revoke all on function private.app_mcp_w_text(jsonb, text, integer, boolean) from public, anon, service_role;
grant execute on function private.app_mcp_w_text(jsonb, text, integer, boolean) to authenticated;

-- 판(version) 칸: 시각 글자만.
create function private.app_mcp_w_version(p_args jsonb)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v text := private.app_mcp_w_text(p_args, 'base_version', 40, false);
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return v::timestamptz;
end
$$;
revoke all on function private.app_mcp_w_version(jsonb) from public, anon, service_role;
grant execute on function private.app_mcp_w_version(jsonb) to authenticated;

-- 날짜 칸(선택): YYYY-MM-DD, 2000~2100.
create function private.app_mcp_w_day(p_args jsonb)
returns date
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v text := private.app_mcp_w_text(p_args, 'day', 10, false);
  d date;
begin
  if v is null then
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  begin
    d := v::date;
  exception when others then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end;
  if d < date '2000-01-01' or d > date '2100-12-31' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return d;
end
$$;
revoke all on function private.app_mcp_w_day(jsonb) from public, anon, service_role;
grant execute on function private.app_mcp_w_day(jsonb) to authenticated;

-- 노트·업데이트가 쓰기에서 빠지나: AI 재료에서 뺀 것(가족 노트 포함)·가족 표시·잠근 폴더(하위)·이름만 적힌 옛 잠근 폴더.
create function private.app_mcp_w_note_blocked(p_meta jsonb, p_ai boolean, p_locks jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_ai is not true
      or coalesce(p_meta ->> 'family_list', '') = 'true' or coalesce(p_meta ->> 'family_past', '') = 'true'
      or (coalesce(p_meta ->> 'folder_id', '') <> '' and coalesce(p_locks -> 'covered', '[]'::jsonb) ? (p_meta ->> 'folder_id'))
      or (coalesce(p_meta ->> 'folder_id', '') = '' and pg_catalog.btrim(coalesce(p_meta ->> 'folder', '')) <> ''
          and coalesce(p_locks -> 'top_names', '[]'::jsonb) ? pg_catalog.btrim(p_meta ->> 'folder'))
$$;
revoke all on function private.app_mcp_w_note_blocked(jsonb, boolean, jsonb) from public, anon, service_role;
grant execute on function private.app_mcp_w_note_blocked(jsonb, boolean, jsonb) to authenticated;

-- 공개 함수 --------------------------------------------------------------------------------------

-- 쓰기 도구를 보여 줄지만(참/거짓). 예외·기록 없음. 입구가 도구 목록을 만들 때 부른다.
create function public.app_mcp_write_tools()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return pg_catalog.jsonb_build_object('allowed', coalesce(private.app_mcp_write_check(false) ->> 'status', '') = 'ok');
end
$$;
revoke all on function public.app_mcp_write_tools() from public, anon, service_role;
grant execute on function public.app_mcp_write_tools() to authenticated;

-- 쓰기 도구 11개. 입력 칸은 도구마다 고정(모르는 칸 거절). 한 호출에 한 건. 결과에 글은 web2_record_get만.
create function public.app_mcp_write(p_tool text, p_args jsonb)
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
  v_day date;
  v_base timestamptz;
  v_title text;
  v_body text;
  v_folder text;
  v_folder_id uuid;
  v_n integer;
  v_page integer;
  v_note public.app_notes%rowtype;
  v_org_id uuid;
  v_org_name text;
  v_space_id uuid;
  v_space_name text;
  v_old text;
  v_old_doc jsonb;
  v_old_one text;
  v_old_created timestamptz;
  v_old_updated timestamptz;
  v_rec_day date;
  v_after timestamptz;
  v_before jsonb;
  v_meta jsonb;
begin
  if pg_catalog.jsonb_typeof(v_args) <> 'object' or pg_catalog.octet_length(v_args::text) > 60000 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_allowed := case p_tool
    when 'web2_record_get' then array['kind', 'id', 'day', 'page']
    when 'web2_note_create' then array['title', 'body', 'folder']
    when 'web2_note_edit' then array['note_id', 'base_version', 'title', 'body', 'folder']
    when 'web2_update_create' then array['body', 'day']
    when 'web2_update_edit' then array['item_id', 'base_version', 'body']
    when 'web2_trash' then array['kind', 'id', 'base_version']
    when 'web2_work_line_add' then array['day', 'line']
    when 'web2_org_record_add' then array['organization', 'text', 'day']
    when 'web2_org_record_edit' then array['record_id', 'base_version', 'text']
    when 'web2_business_record_add' then array['project', 'body', 'day']
    when 'web2_business_record_edit' then array['record_id', 'base_version', 'body']
  end;
  if v_allowed is null then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(v_args) k where k <> all (v_allowed)) then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;

  v_ws := private.app_mcp_write_gate(p_tool);
  v_locks := coalesce(private.app_mcp_note_locks(), '{}'::jsonb);

  -- 고치기 전 읽기 ---------------------------------------------------------------------------
  if p_tool = 'web2_record_get' then
    v_kind := private.app_mcp_w_text(v_args, 'kind', 20, false);
    if v_args ? 'page' and (pg_catalog.jsonb_typeof(v_args -> 'page') <> 'number' or (v_args ->> 'page') !~ '^\d{1,3}$') then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    v_page := coalesce((v_args ->> 'page')::integer, 1);
    if v_page < 1 or v_page > 200 then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    if v_kind in ('note', 'update') then
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'id', 36, false));
      select n.* into v_note from public.app_notes n
       where n.id = v_id and n.workspace_id = v_ws and n.deleted_at is null
         and n.kind = case v_kind when 'note' then 'note' else 'basket' end;
      if v_note.id is null then
        raise exception using errcode = 'P0002', message = 'NOT_FOUND';
      end if;
      if private.app_mcp_w_note_blocked(v_note.metadata, v_note.ai_export_allowed, v_locks) then
        raise exception using errcode = 'PT403', message = 'LOCKED';
      end if;
      perform private.app_mcp_write_note(v_ws, p_tool, v_kind, v_id, null, 'read', null, null, pg_catalog.char_length(v_note.raw_text), v_note.updated_at);
      return pg_catalog.jsonb_build_object('untrusted_text', true, 'records', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', v_kind, 'id', v_note.id, 'title', v_note.title,
        'folder', nullif(pg_catalog.btrim(coalesce(v_note.metadata ->> 'folder', '')), ''),
        'has_format', v_note.doc is not null, 'version', v_note.updated_at,
        'body', private.app_mcp_page(v_note.raw_text, v_page))));
    elsif v_kind = 'work' then
      v_day := private.app_mcp_w_day(v_args);
      if v_day is null or v_args ? 'id' then
        raise exception using errcode = '22023', message = 'BAD_INPUT';
      end if;
      if private.app_mcp_w_diary_locked() then
        raise exception using errcode = 'PT403', message = 'LOCKED';
      end if;
      select n.* into v_note from public.app_notes n
       where n.workspace_id = v_ws and n.kind = 'work' and n.journal_day = v_day and n.deleted_at is null;
      perform private.app_mcp_write_note(v_ws, p_tool, 'work', v_note.id, v_day, 'read', null, null, coalesce(pg_catalog.char_length(v_note.raw_text), 0), v_note.updated_at);
      return pg_catalog.jsonb_build_object('untrusted_text', true, 'records', case when v_note.id is null then '[]'::jsonb else pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'work', 'id', v_note.id, 'day', v_day, 'version', v_note.updated_at,
          'lines', pg_catalog.to_jsonb(pg_catalog.string_to_array(v_note.raw_text, pg_catalog.chr(10))))) end);
    elsif v_kind = 'org_record' then
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'id', 36, false));
      select u.raw_text, coalesce(u.updated_at, u.created_at), o.name, (u.occurred_at at time zone 'Asia/Seoul')::date
        into v_old, v_old_updated, v_org_name, v_rec_day
        from public.app_suborganization_updates u
        join public.app_suborganizations o on o.id = u.organization_id
       where u.id = v_id and o.workspace_id = v_ws and o.deleted_at is null;
      if v_old_updated is null then
        raise exception using errcode = 'P0002', message = 'NOT_FOUND';
      end if;
      perform private.app_mcp_write_note(v_ws, p_tool, 'org_record', v_id, null, 'read', null, null, pg_catalog.char_length(v_old), v_old_updated);
      return pg_catalog.jsonb_build_object('untrusted_text', true, 'records', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', 'org_record', 'id', v_id, 'organization', v_org_name, 'date', v_rec_day, 'version', v_old_updated,
        'text', private.app_mcp_page(v_old, v_page))));
    elsif v_kind = 'business_record' then
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'id', 36, false));
      select r.body, r.updated_at, s.name, r.day into v_old, v_old_updated, v_space_name, v_rec_day
        from public.app_business_records r
        join public.app_spaces s on s.id = r.space_id and s.workspace_id = v_ws and s.deleted_at is null
       where r.id = v_id and r.workspace_id = v_ws;
      if v_old_updated is null then
        raise exception using errcode = 'P0002', message = 'NOT_FOUND';
      end if;
      perform private.app_mcp_write_note(v_ws, p_tool, 'business_record', v_id, null, 'read', null, null, pg_catalog.char_length(v_old), v_old_updated);
      return pg_catalog.jsonb_build_object('untrusted_text', true, 'records', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', 'business_record', 'id', v_id, 'project', v_space_name, 'date', v_rec_day, 'version', v_old_updated, 'text', v_old)));
    end if;
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;

  -- 노트 만들기 -------------------------------------------------------------------------------
  if p_tool = 'web2_note_create' then
    v_title := private.app_mcp_w_text(v_args, 'title', 200, false);
    v_body := coalesce(private.app_mcp_w_text(v_args, 'body', 20000, true), '');
    v_folder := private.app_mcp_w_text(v_args, 'folder', 50, false);
    if v_title is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    v_meta := '{"markdown": true}'::jsonb;
    if v_folder is not null then
      select pg_catalog.count(*)::integer, (pg_catalog.array_agg(f.id))[1] into v_n, v_folder_id
        from public.app_note_folders f where f.workspace_id = v_ws and pg_catalog.lower(f.name) = pg_catalog.lower(v_folder);
      if v_n = 0 then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
      if v_n > 1 then raise exception using errcode = '22023', message = 'AMBIGUOUS'; end if;
      if coalesce(v_locks -> 'covered', '[]'::jsonb) ? v_folder_id::text then
        raise exception using errcode = 'PT403', message = 'LOCKED';
      end if;
      select v_meta || pg_catalog.jsonb_build_object('folder_id', f.id, 'folder', f.name) into v_meta from public.app_note_folders f where f.id = v_folder_id;
    end if;
    insert into public.app_notes(workspace_id, kind, title, raw_text, metadata)
    values (v_ws, 'note', v_title, v_body, v_meta)
    returning id, updated_at into v_id, v_after;
    perform private.app_mcp_write_note(v_ws, p_tool, 'note', v_id, null, 'create', null, 0, pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'note', 'id', v_id, 'version', v_after, 'action', 'create'));
  end if;

  -- 노트·업데이트 고치기, 휴지통 ------------------------------------------------------------------
  if p_tool in ('web2_note_edit', 'web2_update_edit', 'web2_trash') then
    if p_tool = 'web2_trash' then
      v_kind := private.app_mcp_w_text(v_args, 'kind', 20, false);
      if v_kind is null or v_kind not in ('note', 'update') then
        raise exception using errcode = '22023', message = 'BAD_INPUT';
      end if;
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'id', 36, false));
    elsif p_tool = 'web2_note_edit' then
      v_kind := 'note';
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'note_id', 36, false));
    else
      v_kind := 'update';
      v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'item_id', 36, false));
    end if;
    v_base := private.app_mcp_w_version(v_args);
    select n.* into v_note from public.app_notes n
     where n.id = v_id and n.workspace_id = v_ws and n.deleted_at is null
       and n.kind = case v_kind when 'note' then 'note' else 'basket' end
     for update;
    if v_note.id is null then
      raise exception using errcode = 'P0002', message = 'NOT_FOUND';
    end if;
    if private.app_mcp_w_note_blocked(v_note.metadata, v_note.ai_export_allowed, v_locks) then
      raise exception using errcode = 'PT403', message = 'LOCKED';
    end if;
    if v_note.updated_at <> v_base then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;

    if p_tool = 'web2_trash' then
      -- 휴지통 트리거(BEFORE DELETE)가 deleted_at만 채우고 행은 남긴다. 완전 삭제는 없다.
      delete from public.app_notes n where n.id = v_id and n.workspace_id = v_ws and n.updated_at = v_base;
      if exists (select 1 from public.app_notes n where n.id = v_id) then
        raise exception using errcode = '40001', message = 'CHANGED';
      end if;
      perform private.app_mcp_write_note(v_ws, p_tool, v_kind, v_id, null, 'trash', null,
        pg_catalog.char_length(v_note.raw_text), pg_catalog.char_length(v_note.raw_text), v_note.updated_at);
      return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', v_kind, 'id', v_id, 'action', 'trash'));
    end if;

    v_title := case when p_tool = 'web2_note_edit' then private.app_mcp_w_text(v_args, 'title', 200, false) end;
    v_body := private.app_mcp_w_text(v_args, 'body', 20000, true);
    v_folder := case when p_tool = 'web2_note_edit' then private.app_mcp_w_text(v_args, 'folder', 50, false) end;
    if v_args ? 'body' and v_body is null and v_kind = 'note' then
      v_body := '';
    end if;
    if v_title is null and v_body is null and v_folder is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    v_meta := v_note.metadata;
    if v_folder is not null then
      select pg_catalog.count(*)::integer, (pg_catalog.array_agg(f.id))[1] into v_n, v_folder_id
        from public.app_note_folders f where f.workspace_id = v_ws and pg_catalog.lower(f.name) = pg_catalog.lower(v_folder);
      if v_n = 0 then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
      if v_n > 1 then raise exception using errcode = '22023', message = 'AMBIGUOUS'; end if;
      if coalesce(v_locks -> 'covered', '[]'::jsonb) ? v_folder_id::text then
        raise exception using errcode = 'PT403', message = 'LOCKED';
      end if;
      select (v_meta - 'folder_id' - 'folder') || pg_catalog.jsonb_build_object('folder_id', f.id, 'folder', f.name) into v_meta
        from public.app_note_folders f where f.id = v_folder_id;
    end if;
    v_before := pg_catalog.jsonb_build_object('title', v_note.title, 'raw_text', v_note.raw_text, 'doc', v_note.doc,
      'folder_id', v_note.metadata -> 'folder_id', 'folder', v_note.metadata -> 'folder');
    -- 본문을 바꾸면 편집기 서식(doc)은 비운다(옛 서식은 되돌리기 자료에 남음).
    update public.app_notes n
       set title = case when v_kind = 'note' then coalesce(v_title, n.title) else n.title end,
           raw_text = coalesce(v_body, n.raw_text),
           doc = case when v_body is not null then null else n.doc end,
           metadata = v_meta,
           updated_at = pg_catalog.clock_timestamp()
     where n.id = v_id and n.workspace_id = v_ws and n.updated_at = v_base
     returning n.updated_at into v_after;
    if v_after is null then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;
    perform private.app_mcp_write_note(v_ws, p_tool, v_kind, v_id, null, 'edit', v_before,
      pg_catalog.char_length(v_note.raw_text), pg_catalog.char_length(coalesce(v_body, v_note.raw_text)), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', v_kind, 'id', v_id, 'version', v_after, 'action', 'edit'));
  end if;

  -- 업데이트 만들기 ----------------------------------------------------------------------------
  if p_tool = 'web2_update_create' then
    v_body := private.app_mcp_w_text(v_args, 'body', 20000, true);
    v_day := private.app_mcp_w_day(v_args);
    if v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    insert into public.app_notes(workspace_id, kind, raw_text, occurred_at)
    values (v_ws, 'basket', v_body,
            case when v_day is null then pg_catalog.now() else (v_day::timestamp + interval '12 hours') at time zone 'Asia/Seoul' end)
    returning id, updated_at into v_id, v_after;
    perform private.app_mcp_write_note(v_ws, p_tool, 'update', v_id, v_day, 'create', null, 0, pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'update', 'id', v_id, 'version', v_after, 'action', 'create'));
  end if;

  -- 업무일지 한 줄 ----------------------------------------------------------------------------
  if p_tool = 'web2_work_line_add' then
    v_day := private.app_mcp_w_day(v_args);
    v_body := private.app_mcp_w_text(v_args, 'line', 300, false);
    if v_day is null or v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    if private.app_mcp_w_diary_locked() then
      raise exception using errcode = 'PT403', message = 'LOCKED';
    end if;
    select n.* into v_note from public.app_notes n
     where n.workspace_id = v_ws and n.kind = 'work' and n.journal_day = v_day and n.deleted_at is null
     for update;
    if v_note.id is null then
      insert into public.app_notes(workspace_id, kind, raw_text, journal_day, occurred_at)
      values (v_ws, 'work', v_body, v_day, (v_day::timestamp + interval '12 hours') at time zone 'Asia/Seoul')
      returning id, updated_at into v_id, v_after;
      v_before := pg_catalog.jsonb_build_object('raw_text', null);
      v_n := 0;
    else
      if pg_catalog.array_length(pg_catalog.string_to_array(v_note.raw_text, pg_catalog.chr(10)), 1) >= 50 then
        raise exception using errcode = '22023', message = 'BAD_INPUT';
      end if;
      update public.app_notes n
         set raw_text = n.raw_text || pg_catalog.chr(10) || v_body, updated_at = pg_catalog.clock_timestamp()
       where n.id = v_note.id and n.workspace_id = v_ws
       returning n.id, n.updated_at into v_id, v_after;
      v_before := pg_catalog.jsonb_build_object('raw_text', v_note.raw_text);
      v_n := pg_catalog.char_length(v_note.raw_text);
    end if;
    perform private.app_mcp_write_note(v_ws, p_tool, 'work', v_id, v_day, 'append', v_before, v_n, v_n + pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'work', 'id', v_id, 'day', v_day, 'version', v_after, 'action', 'append'));
  end if;

  -- 담당조직 기록 ----------------------------------------------------------------------------
  if p_tool = 'web2_org_record_add' then
    v_title := private.app_mcp_w_text(v_args, 'organization', 50, false);
    v_body := private.app_mcp_w_text(v_args, 'text', 4000, true);
    v_day := private.app_mcp_w_day(v_args);
    if v_title is null or v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    select pg_catalog.count(*)::integer, (pg_catalog.array_agg(o.id))[1] into v_n, v_org_id
      from public.app_suborganizations o
     where o.workspace_id = v_ws and o.deleted_at is null
       and (o.id::text = pg_catalog.lower(v_title) or pg_catalog.lower(o.name) = pg_catalog.lower(v_title));
    if v_n = 0 then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_n > 1 then raise exception using errcode = '22023', message = 'AMBIGUOUS'; end if;
    v_after := pg_catalog.clock_timestamp();
    insert into public.app_suborganization_updates(organization_id, raw_text, occurred_at, created_by, updated_at)
    values (v_org_id, v_body,
            case when v_day is null then pg_catalog.now() else (v_day::timestamp + interval '12 hours') at time zone 'Asia/Seoul' end,
            (select auth.uid()), v_after)
    returning id into v_id;
    perform private.app_mcp_write_note(v_ws, p_tool, 'org_record', v_id, v_day, 'create', null, 0, pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'org_record', 'id', v_id, 'version', v_after, 'action', 'create'));
  end if;

  if p_tool = 'web2_org_record_edit' then
    v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'record_id', 36, false));
    v_base := private.app_mcp_w_version(v_args);
    v_body := private.app_mcp_w_text(v_args, 'text', 4000, true);
    if v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    select u.raw_text, u.doc, u.one_line, coalesce(u.updated_at, u.created_at)
      into v_old, v_old_doc, v_old_one, v_old_updated
      from public.app_suborganization_updates u
      join public.app_suborganizations o on o.id = u.organization_id
     where u.id = v_id and o.workspace_id = v_ws and o.deleted_at is null
     for update of u;
    if v_old_updated is null then
      raise exception using errcode = 'P0002', message = 'NOT_FOUND';
    end if;
    if v_old_updated <> v_base then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;
    v_after := pg_catalog.clock_timestamp();
    update public.app_suborganization_updates u
       set raw_text = v_body, doc = null, updated_at = v_after
     where u.id = v_id and coalesce(u.updated_at, u.created_at) = v_base;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;
    perform private.app_mcp_write_note(v_ws, p_tool, 'org_record', v_id, null, 'edit',
      pg_catalog.jsonb_build_object('raw_text', v_old, 'doc', v_old_doc, 'one_line', v_old_one),
      pg_catalog.char_length(v_old), pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'org_record', 'id', v_id, 'version', v_after, 'action', 'edit'));
  end if;

  -- 사업 기록 --------------------------------------------------------------------------------
  if p_tool = 'web2_business_record_add' then
    v_title := private.app_mcp_w_text(v_args, 'project', 50, false);
    v_body := private.app_mcp_w_text(v_args, 'body', 300, false);
    v_day := coalesce(private.app_mcp_w_day(v_args), (pg_catalog.now() at time zone 'Asia/Seoul')::date);
    if v_title is null or v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    select pg_catalog.count(*)::integer, (pg_catalog.array_agg(s.id))[1] into v_n, v_space_id
      from public.app_spaces s
     where s.workspace_id = v_ws and s.deleted_at is null
       and (s.id::text = pg_catalog.lower(v_title) or pg_catalog.lower(s.name) = pg_catalog.lower(v_title));
    if v_n = 0 then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_n > 1 then raise exception using errcode = '22023', message = 'AMBIGUOUS'; end if;
    insert into public.app_business_records(workspace_id, space_id, day, body, source_kind)
    values (v_ws, v_space_id, v_day, v_body, 'user')
    returning id, updated_at into v_id, v_after;
    perform private.app_mcp_write_note(v_ws, p_tool, 'business_record', v_id, v_day, 'create', null, 0, pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'business_record', 'id', v_id, 'version', v_after, 'action', 'create'));
  end if;

  if p_tool = 'web2_business_record_edit' then
    v_id := private.app_mcp_uuid(private.app_mcp_w_text(v_args, 'record_id', 36, false));
    v_base := private.app_mcp_w_version(v_args);
    v_body := private.app_mcp_w_text(v_args, 'body', 300, false);
    if v_body is null then
      raise exception using errcode = '22023', message = 'BAD_INPUT';
    end if;
    select r.body, r.updated_at into v_old, v_old_updated
      from public.app_business_records r
      join public.app_spaces s on s.id = r.space_id and s.workspace_id = v_ws and s.deleted_at is null
     where r.id = v_id and r.workspace_id = v_ws
     for update of r;
    if v_old_updated is null then
      raise exception using errcode = 'P0002', message = 'NOT_FOUND';
    end if;
    if v_old_updated <> v_base then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;
    update public.app_business_records r set body = v_body
     where r.id = v_id and r.workspace_id = v_ws and r.updated_at = v_base
     returning r.updated_at into v_after;
    if v_after is null then
      raise exception using errcode = '40001', message = 'CHANGED';
    end if;
    perform private.app_mcp_write_note(v_ws, p_tool, 'business_record', v_id, null, 'edit',
      pg_catalog.jsonb_build_object('body', v_old), pg_catalog.char_length(v_old), pg_catalog.char_length(v_body), v_after);
    return pg_catalog.jsonb_build_object('result', pg_catalog.jsonb_build_object('ok', true, 'kind', 'business_record', 'id', v_id, 'version', v_after, 'action', 'edit'));
  end if;

  raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
end
$$;
revoke all on function public.app_mcp_write(text, jsonb) from public, anon, service_role;
grant execute on function public.app_mcp_write(text, jsonb) to authenticated;

-- 되돌리기(화면 전용). 위임 열쇠는 거절. 그사이 바뀌었으면(판이 다르면) 거절 — 사용자 글을 덮지 않는다.
create function public.app_mcp_write_undo(p_log_id uuid)
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

-- 사후 확인: 운영자 표 권한 그대로, mcp_write 행은 calls 작업공간 하나뿐. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'mcp_write') <> 1
     or not exists (select 1 from public.app_operator_features p join public.app_operator_features c
                     on c.workspace_id = p.workspace_id and c.feature = 'calls' where p.feature = 'mcp_write') then
    raise exception 'MCP_CLAUDE_WRITE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261128100000', 'mcp_claude_write', array['MCP-Claude쓰기: operator feature key mcp_write with one allow row for the single calls workspace; app_mcp_settings.write_enabled (default false, screen only); tables app_mcp_write_log and app_mcp_write_before (RLS, owner select); private write gate and helpers; public app_mcp_write, app_mcp_write_tools, app_mcp_write_undo (invoker, authenticated only)']);
commit;
