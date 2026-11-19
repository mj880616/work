begin;
-- MCP-Claude읽기 M-3(DB). 설계 docs/design/mcp-claude-read.md 2판 7절. 명진 11/20 08:09 "진행하세요"(결정 D1 가·D2 노트 제목+앞 200자·업무일지 제외·D3 1분 20번·하루 300번).
-- 이 파일은 Claude(claude.ai 커넥터)가 Web2를 읽기만 하는 DB 쪽 문(표 2개·문지기·읽기 함수 7개)만 만든다.
-- 요청 전 함수(L1, authenticator 역할 설정)와 Storage 제한 정책(L2)은 승인형 workflow 규칙이 받지 않는 모양이라
-- (alter role·storage 스키마 정책·anon 실행권) 짝 SQL Editor 파일 docs/ops/mcp-claude-read-guard.*.sql로 나눴다(PR 본문 'CC 판단 항목').
--
-- 무엇:
--   표 app_mcp_settings(작업공간마다 0~1행: 켜짐·허용 클라이언트·연결 끊은 시각) — 설정 행은 이 파일에 넣지 않는다(공개 저장소, M-6에서 CC가 SQL로).
--   표 app_mcp_read_log(호출 기록: 언제·어떤 도구·결과 건수. 검색어·입력·응답 내용·열쇠·IP는 없음).
--   문지기 private.app_mcp_gate(도구) — 열쇠의 client_id·허용 클라이언트·owner 작업공간 1개·켜짐·연결 끊기·상한(1분 20번·하루 300번, KST)을 매 호출 확인하고 기록 1행.
--   읽기 함수 public.app_mcp_* 7개(입구 mcp-read 도구와 1:1): 조직 현황·사업 보고·프로젝트 현황·원장 검색·원장 한 건·노트 검색·Google 찾는 길.
-- 보안(AGENTS.md 3절, 설계 4.3·5.3):
--   - 읽기 함수는 SECURITY INVOKER + search_path ''. 기존 owner RLS가 그대로 걸리고, 문지기를 먼저 통과해야 한다. 작업공간·사용자 값을 입력으로 받지 않는다.
--   - 문지기·기록·잠금 목록 도우미만 SECURITY DEFINER(search_path ''), 실행권은 authenticated만(읽기 함수가 authenticated로 부르므로). private 스키마는 API에 없다.
--   - 새 표: RLS 켬, owner 정책(authenticated만), PUBLIC·anon·service_role 권한 없음. 설정 표는 화면이 enabled·revoked_before·updated_at만 고칠 수 있고
--     (칸 단위 권한), allowed_client_id는 화면·API가 못 고친다. 위임 열쇠(client_id 있음)로는 설정을 못 고친다(정책 조건).
--     기록 표는 owner 읽기만, 넣기·고치기는 문지기 함수만.
--   - 빼는 것(영구, 5.3): 일기·정리함(바구니)·업무일지 노트(kind 'note'만 읽음), 통화·녹음·회의 녹취, 텔레그램·바깥 수집, 가족 방, 다른 제품 표는
--     어떤 함수도 읽지 않는다(시험이 표 이름으로 고정). AI 내보내기 금지 노트·잠근 노트 폴더(하위 포함)의 노트는 제목도 내지 않는다.
--     원장 S2는 ID·종류·기준일·제목·유효상태만(요지·이유·상대측·출처 위치 없음). 원장은 업무 범위(work)만, 민감도 상한은 함수가 고정.
--   - 기존 표·정책·권한·함수·자료는 한 줄도 바꾸지 않는다. 기존 app_ledger_search·app_lock_note_folder_list는 부르기만 한다.
-- 거절 문구(입구 mcp-read core.mjs mapRpcFailure와 맞춤): NOT_ALLOWED(PT403)·DISCONNECTED(PT403)·RATE_LIMITED(PT429)·BAD_INPUT(22023).
--   거절은 예외라 그 호출의 기록 행도 함께 취소된다(기록 없는 읽기는 없음). 상한은 통과한(ok) 기록만 센다.
-- 짝: docs/20261120090000_mcp_claude_read.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120090000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261021082000' and name = 'ledger_schema') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261119233000' and name = 'note_folder_lock') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('public.app_ledger_search(text,text[],uuid,uuid,date,date,text,text,boolean,integer)') is null
     or to_regprocedure('private.app_lock_note_folder_list(uuid)') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('auth.jwt()') is null
     or to_regclass('auth.sessions') is null
     or to_regclass('public.app_mcp_settings') is not null
     or to_regclass('public.app_mcp_read_log') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'app\_mcp\_%') then
    raise exception 'MCP_CLAUDE_READ_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 표 ---------------------------------------------------------------------------------------------

create table public.app_mcp_settings (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  enabled boolean not null default false,
  allowed_client_id text,
  revoked_before timestamptz,
  updated_at timestamptz not null default now(),
  constraint app_mcp_settings_client_check check (
    allowed_client_id is null or (char_length(allowed_client_id) between 1 and 200 and allowed_client_id !~ '[[:cntrl:][:space:]]'))
);

create table public.app_mcp_read_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  called_at timestamptz not null default now(),
  tool text not null,
  status text not null,
  result_count integer,
  withheld_count integer,
  constraint app_mcp_read_log_tool_check check (tool in ('web2_org_status', 'web2_business_reports', 'web2_project_status',
    'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where')),
  constraint app_mcp_read_log_status_check check (status in ('ok', 'limited', 'denied', 'error')),
  constraint app_mcp_read_log_counts_check check (
    (result_count is null or result_count between 0 and 100000) and (withheld_count is null or withheld_count between 0 and 100000))
);
create index app_mcp_read_log_scope_idx on public.app_mcp_read_log(workspace_id, called_at desc);

alter table public.app_mcp_settings enable row level security;
alter table public.app_mcp_read_log enable row level security;
revoke all on table public.app_mcp_settings from public, anon, authenticated, service_role;
revoke all on table public.app_mcp_read_log from public, anon, authenticated, service_role;
grant select on table public.app_mcp_settings to authenticated;
grant update (enabled, revoked_before, updated_at) on table public.app_mcp_settings to authenticated;
grant select on table public.app_mcp_read_log to authenticated;

create policy app_mcp_settings_owner_select on public.app_mcp_settings for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
-- 위임 열쇠(client_id 있음)로는 스위치·연결 끊기를 못 바꾼다(요청 전 함수가 없어도 남는 겹).
create policy app_mcp_settings_owner_update on public.app_mcp_settings for update to authenticated
  using (private.app_is_workspace_owner(workspace_id) and coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  with check (private.app_is_workspace_owner(workspace_id) and coalesce((select auth.jwt()) ->> 'client_id', '') = '');
create policy app_mcp_read_log_owner_select on public.app_mcp_read_log for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- private 도우미 -------------------------------------------------------------------------------------

-- 문지기. 모든 읽기 함수가 맨 먼저 부른다. 하나라도 아니면 예외(거절). 통과하면 ok 기록 1행을 쓰고 작업공간을 돌려준다.
create function private.app_mcp_gate(p_tool text)
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

-- 같은 호출(같은 트랜잭션 시각)의 기록 행에 돌려준 건수·뺀 건수만 채운다. 내 작업공간 행만.
create function private.app_mcp_gate_done(p_tool text, p_count integer, p_withheld integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_mcp_read_log l
     set result_count = greatest(0, least(coalesce(p_count, 0), 100000)),
         withheld_count = greatest(0, least(coalesce(p_withheld, 0), 100000))
   where l.tool = p_tool and l.status = 'ok' and l.result_count is null
     and l.called_at = pg_catalog.now() and private.app_is_workspace_owner(l.workspace_id);
end
$$;
revoke all on function private.app_mcp_gate_done(text, integer, integer) from public, anon, service_role;
grant execute on function private.app_mcp_gate_done(text, integer, integer) to authenticated;

-- 잠근 노트 폴더(하위 포함)와 이름만 적힌 옛 노트용 맨 위 폴더 이름. 잠금 표는 API 역할에 닫혀 있어 DEFINER로 기존 목록 함수를 부른다.
create function private.app_mcp_note_locks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then '{}'::jsonb
              else private.app_lock_note_folder_list((select auth.uid())) end
$$;
revoke all on function private.app_mcp_note_locks() from public, anon, service_role;
grant execute on function private.app_mcp_note_locks() to authenticated;

-- 글 칸 정리: 제어 문자 → 빈칸, 앞뒤 빈칸 제거, 길이 상한.
create function private.app_mcp_clip(p_text text, p_max integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]+', ' ', 'g')),
    greatest(1, least(coalesce(p_max, 300), 2000))), '')
$$;
revoke all on function private.app_mcp_clip(text, integer) from public, anon, service_role;
grant execute on function private.app_mcp_clip(text, integer) to authenticated;

-- 입력 글 검사(앞뒤 빈칸 정리, 제어 문자·길이 거절). 빈 글은 null.
create function private.app_mcp_arg(p_text text, p_max integer)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := nullif(pg_catalog.btrim(coalesce(p_text, '')), '');
begin
  if v is not null and (pg_catalog.char_length(v) > p_max or v ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return v;
end
$$;
revoke all on function private.app_mcp_arg(text, integer) from public, anon, service_role;
grant execute on function private.app_mcp_arg(text, integer) to authenticated;

-- 읽기 함수 (도구마다 1개) -----------------------------------------------------------------------------

-- web2_org_status: 담당조직 현황. 이름·ID가 없으면 내 담당조직(활성 + 내 담당, 담당이 없으면 활성 전체 — drive-summary와 같은 규칙).
-- 한 조직이면 최근 28일 조직 기록 요지(앞 300자, 최대 20건)를 더한다. 연혁·메모·year_summary·담당자 목록·기록 전문은 없음.
create function public.app_mcp_org_status(p_organization text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_organization, 50);
  v_ws uuid;
  v_ids uuid[];
  v_records jsonb;
  v_updates jsonb := '[]'::jsonb;
  v_since timestamptz := (((pg_catalog.now() at time zone 'Asia/Seoul')::date - 27)::timestamp) at time zone 'Asia/Seoul';
begin
  v_ws := private.app_mcp_gate('web2_org_status');
  if v_q is null then
    select pg_catalog.array_agg(o.id order by o.name) into v_ids
      from public.app_suborganizations o
     where o.workspace_id = v_ws and o.deleted_at is null and o.active is not false
       and exists (select 1 from public.app_suborganization_assignees a
                    where a.organization_id = o.id and a.user_id = (select auth.uid()));
    if v_ids is null then
      select pg_catalog.array_agg(o.id order by o.name) into v_ids
        from public.app_suborganizations o
       where o.workspace_id = v_ws and o.deleted_at is null and o.active is not false;
    end if;
  else
    select pg_catalog.array_agg(o.id order by o.name) into v_ids
      from public.app_suborganizations o
     where o.workspace_id = v_ws and o.deleted_at is null
       and (o.id::text = pg_catalog.lower(v_q) or pg_catalog.lower(o.name) = pg_catalog.lower(v_q)
            or exists (select 1 from pg_catalog.unnest(coalesce(o.aliases, '{}'::text[])) x where pg_catalog.lower(x) = pg_catalog.lower(v_q)));
    if v_ids is null then
      select pg_catalog.array_agg(k.id order by k.name) into v_ids
        from (select o.id, o.name from public.app_suborganizations o
               where o.workspace_id = v_ws and o.deleted_at is null
                 and pg_catalog.strpos(pg_catalog.lower(o.name), pg_catalog.lower(v_q)) > 0
               order by o.name limit 6) k;
    end if;
  end if;
  v_ids := coalesce(v_ids[1:50], '{}'::uuid[]);

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'organization', 'id', o.id, 'name', private.app_mcp_clip(o.name, 100), 'active', o.active is not false,
      'summary', private.app_mcp_clip(o.recent_month_summary, 300),
      'dispute_stage', (select pg_catalog.jsonb_build_object('name', private.app_mcp_clip(d.stage_name, 20), 'date', d.stage_date)
                          from public.app_suborganization_dispute_stages d
                         where d.organization_id = o.id
                         order by d.stage_date desc, d.created_at desc limit 1))
      order by o.name), '[]'::jsonb) into v_records
    from public.app_suborganizations o
   where o.id = any (v_ids) and o.workspace_id = v_ws;

  if v_q is not null and pg_catalog.cardinality(v_ids) = 1 then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', 'org_update', 'id', k.id, 'organization', private.app_mcp_clip(k.name, 100),
        'date', (k.occurred_at at time zone 'Asia/Seoul')::date, 'text', private.app_mcp_clip(k.raw_text, 300))
        order by k.occurred_at desc), '[]'::jsonb) into v_updates
      from (select u.id, u.occurred_at, u.raw_text, o.name
              from public.app_suborganization_updates u
              join public.app_suborganizations o on o.id = u.organization_id and o.workspace_id = v_ws and o.deleted_at is null
             where u.organization_id = v_ids[1] and u.occurred_at >= v_since
             order by u.occurred_at desc limit 20) k;
  end if;
  v_records := v_records || v_updates;
  perform private.app_mcp_gate_done('web2_org_status', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object());
end
$$;
revoke all on function public.app_mcp_org_status(text) from public, anon, service_role;
grant execute on function public.app_mcp_org_status(text) to authenticated;

-- web2_business_reports: 사업 보고(날짜·끝날짜·본문 300자 이하·프로젝트 이름). 기간 최대 90일, 기본 최근 30일(KST). 휴지통 프로젝트 제외(RLS).
create function public.app_mcp_business_reports(p_from date default null, p_to date default null, p_project text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_project, 50);
  v_to date := coalesce(p_to, (pg_catalog.now() at time zone 'Asia/Seoul')::date);
  v_from date;
  v_ws uuid;
  v_ids uuid[];
  v_records jsonb;
  v_total integer;
begin
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to or v_to - v_from > 89 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_business_reports');
  if v_q is not null then
    select pg_catalog.array_agg(s.id) into v_ids from public.app_spaces s
     where s.workspace_id = v_ws and s.deleted_at is null
       and (s.id::text = pg_catalog.lower(v_q) or pg_catalog.lower(s.name) = pg_catalog.lower(v_q));
    if v_ids is null then
      select pg_catalog.array_agg(k.id) into v_ids
        from (select s.id from public.app_spaces s
               where s.workspace_id = v_ws and s.deleted_at is null
                 and pg_catalog.strpos(pg_catalog.lower(s.name), pg_catalog.lower(v_q)) > 0
               order by s.name limit 6) k;
    end if;
    v_ids := coalesce(v_ids, '{}'::uuid[]);
  end if;

  select pg_catalog.count(*)::integer into v_total
    from public.app_business_records r
    join public.app_spaces s on s.id = r.space_id and s.workspace_id = v_ws and s.deleted_at is null
   where r.workspace_id = v_ws and r.day <= v_to and coalesce(r.end_day, r.day) >= v_from
     and (v_ids is null or r.space_id = any (v_ids));
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'business_record', 'id', k.id, 'date', k.day, 'end_date', k.end_day,
      'project', private.app_mcp_clip(k.name, 100), 'text', private.app_mcp_clip(k.body, 300))
      order by k.day desc, k.id), '[]'::jsonb) into v_records
    from (select r.id, r.day, r.end_day, r.body, s.name
            from public.app_business_records r
            join public.app_spaces s on s.id = r.space_id and s.workspace_id = v_ws and s.deleted_at is null
           where r.workspace_id = v_ws and r.day <= v_to and coalesce(r.end_day, r.day) >= v_from
             and (v_ids is null or r.space_id = any (v_ids))
           order by r.day desc, r.id limit 200) k;
  perform private.app_mcp_gate_done('web2_business_reports', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > 200, 'withheld', pg_catalog.jsonb_build_object(),
    'period', pg_catalog.jsonb_build_object('from', v_from, 'to', v_to));
end
$$;
revoke all on function public.app_mcp_business_reports(date, date, text) from public, anon, service_role;
grant execute on function public.app_mcp_business_reports(date, date, text) to authenticated;

-- web2_project_status: 프로젝트 현황(Web2 프로젝트 체계 v2와 그 아래만). 이름·ID가 없으면 진행 중 목록.
-- 한 프로젝트면 갈래·진행 기록 최근 10건·다가오는 주요 일정·미완료 할 일 개수·자료 개수. 보관 프로젝트는 "보관됨" 한 줄. 할 일·자료 제목은 없음.
create function public.app_mcp_project_status(p_project text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_project, 50);
  v_ws uuid;
  v_all uuid[];
  v_ids uuid[];
  v_one uuid;
  v_status text;
  v_records jsonb;
  v_total integer;
begin
  v_ws := private.app_mcp_gate('web2_project_status');
  with recursive tree as (
    select s.id from public.app_spaces s
     where s.workspace_id = v_ws and s.deleted_at is null
       and (s.metadata ->> 'project_system' = 'v2' or s.metadata ->> 'management_version' = '2')
    union
    select c.id from public.app_spaces c join tree t on c.parent_id = t.id
     where c.workspace_id = v_ws and c.deleted_at is null
  )
  select pg_catalog.array_agg(t.id) into v_all from tree t;
  v_all := coalesce(v_all, '{}'::uuid[]);

  if v_q is null then
    select pg_catalog.count(*)::integer into v_total from public.app_spaces s
     where s.id = any (v_all) and s.status is distinct from 'archived';
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', 'project', 'id', k.id, 'name', private.app_mcp_clip(k.name, 100), 'status', k.status,
        'parent', private.app_mcp_clip(k.parent_name, 100)) order by k.name), '[]'::jsonb) into v_records
      from (select s.id, s.name, s.status, p.name as parent_name
              from public.app_spaces s
              left join public.app_spaces p on p.id = s.parent_id and p.id = any (v_all)
             where s.id = any (v_all) and s.status is distinct from 'archived'
             order by s.name limit 100) k;
    perform private.app_mcp_gate_done('web2_project_status', pg_catalog.jsonb_array_length(v_records), 0);
    return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > 100, 'withheld', pg_catalog.jsonb_build_object());
  end if;

  select pg_catalog.array_agg(s.id order by s.name) into v_ids from public.app_spaces s
   where s.id = any (v_all) and (s.id::text = pg_catalog.lower(v_q) or pg_catalog.lower(s.name) = pg_catalog.lower(v_q));
  if v_ids is null then
    select pg_catalog.array_agg(k.id order by k.name) into v_ids
      from (select s.id, s.name from public.app_spaces s
             where s.id = any (v_all) and pg_catalog.strpos(pg_catalog.lower(s.name), pg_catalog.lower(v_q)) > 0
             order by s.name limit 6) k;
  end if;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if pg_catalog.cardinality(v_ids) <> 1 then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', 'project', 'id', s.id, 'name', private.app_mcp_clip(s.name, 100), 'status', s.status) order by s.name), '[]'::jsonb)
      into v_records from public.app_spaces s where s.id = any (v_ids);
    perform private.app_mcp_gate_done('web2_project_status', pg_catalog.jsonb_array_length(v_records), 0);
    return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object());
  end if;

  v_one := v_ids[1];
  select s.status into v_status from public.app_spaces s where s.id = v_one;
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type', 'project', 'id', s.id, 'name', private.app_mcp_clip(s.name, 100), 'status', s.status,
      'parent', (select private.app_mcp_clip(p.name, 100) from public.app_spaces p where p.id = s.parent_id and p.id = any (v_all)),
      'open_task_count', case when v_status = 'archived' then null else
        (select pg_catalog.count(*) from public.app_record_links rl
          where rl.workspace_id = v_ws and rl.project_id = s.id and rl.google_task_id is not null
            and rl.task_completed = false and rl.status = 'confirmed') end,
      'document_count', case when v_status = 'archived' then null else
        (select pg_catalog.count(*) from public.app_documents d where d.workspace_id = v_ws and d.project_id = s.id) end))
    into v_records from public.app_spaces s where s.id = v_one;

  if v_status is distinct from 'archived' then
    v_records := v_records
      || coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'type', 'workstream', 'id', k.id, 'title', private.app_mcp_clip(k.title, 100), 'phase', private.app_mcp_clip(k.phase, 40))
            order by k.sort_order, k.id)
          from (select w.id, w.title, w.phase, w.sort_order from public.app_project_workstreams w
                 where w.project_id = v_one order by w.sort_order, w.id limit 30) k), '[]'::jsonb)
      || coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'type', 'progress', 'id', k.id, 'date', k.effective_on, 'status', private.app_mcp_clip(k.status_label, 40),
            'summary', private.app_mcp_clip(k.summary, 300), 'next_step', private.app_mcp_clip(k.next_step, 300))
            order by k.effective_on desc nulls last, k.id)
          from (select g.id, g.effective_on, g.status_label, g.summary, g.next_step from public.app_project_progress_updates g
                 where g.project_id = v_one order by g.effective_on desc nulls last, g.id limit 10) k), '[]'::jsonb)
      || coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'type', 'milestone', 'id', k.id, 'title', private.app_mcp_clip(k.title, 100),
            'date', (k.start_at at time zone 'Asia/Seoul')::date) order by k.start_at, k.id)
          from (select m.id, m.title, m.start_at from public.app_project_milestones m
                 where m.project_id = v_one and m.start_at >= pg_catalog.now() order by m.start_at, m.id limit 10) k), '[]'::jsonb);
  end if;
  perform private.app_mcp_gate_done('web2_project_status', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object());
end
$$;
revoke all on function public.app_mcp_project_status(text) from public, anon, service_role;
grant execute on function public.app_mcp_project_status(text) to authenticated;

-- ledger_search: 원장 검색. app_ledger_search를 민감도 상한 S2·업무 범위·현재 유효 기록으로 고정해 부른다(Claude가 못 바꿈).
-- S0·S1은 요지 앞 300자·주제·조직, S2는 ID·종류·기준일·제목·유효상태만.
create function public.app_mcp_ledger_search(p_query text, p_organization text default null, p_topic text default null,
  p_from date default null, p_to date default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_org_q text := private.app_mcp_arg(p_organization, 50);
  v_topic_q text := private.app_mcp_arg(p_topic, 50);
  v_limit integer := coalesce(p_limit, 20);
  v_ws uuid;
  v_org uuid;
  v_topic uuid;
  v_records jsonb := '[]'::jsonb;
  v_s2 integer := 0;
begin
  if v_q is null or v_limit < 1 or v_limit > 50 or (p_from is not null and p_to is not null and p_to < p_from) then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('ledger_search');
  if v_org_q is not null then
    select o.id into v_org from public.app_ledger_organizations o
     where o.workspace_id = v_ws and (pg_catalog.upper(o.ledger_id) = pg_catalog.upper(v_org_q) or pg_catalog.lower(o.name) = pg_catalog.lower(v_org_q)
            or exists (select 1 from pg_catalog.unnest(o.aliases) x where pg_catalog.lower(x) = pg_catalog.lower(v_org_q)))
     order by o.ledger_id limit 1;
    if v_org is null then
      select so.id into v_org from public.app_suborganizations so
       where so.workspace_id = v_ws and so.deleted_at is null and pg_catalog.lower(so.name) = pg_catalog.lower(v_org_q)
       order by so.id limit 1;
    end if;
  end if;
  if v_topic_q is not null then
    select t.id into v_topic from public.app_ledger_topics t
     where t.workspace_id = v_ws and (pg_catalog.upper(t.ledger_id) = pg_catalog.upper(v_topic_q) or pg_catalog.lower(t.name) = pg_catalog.lower(v_topic_q)
            or exists (select 1 from pg_catalog.unnest(t.aliases) x where pg_catalog.lower(x) = pg_catalog.lower(v_topic_q)))
     order by t.ledger_id limit 1;
  end if;
  if (v_org_q is null or v_org is not null) and (v_topic_q is null or v_topic is not null) then
    select coalesce(pg_catalog.jsonb_agg(case when h.sensitivity = 'S2' then pg_catalog.jsonb_build_object(
          'type', 'ledger', 'ledger_id', h.ledger_id, 'kind', h.kind, 'date', h.date_start,
          'title', private.app_mcp_clip(h.title, 300), 'validity', h.validity, 'sensitivity', 'S2')
        else pg_catalog.jsonb_build_object(
          'type', 'ledger', 'ledger_id', h.ledger_id, 'kind', h.kind, 'date', h.date_start, 'end_date', h.date_end,
          'title', private.app_mcp_clip(h.title, 300), 'validity', h.validity, 'sensitivity', h.sensitivity,
          'summary', private.app_mcp_clip(h.summary, 300), 'topic', private.app_mcp_clip(h.topic_name, 80),
          'organizations', pg_catalog.to_jsonb(coalesce(h.organizations, '{}'::text[]))) end
        order by h.ord), '[]'::jsonb),
      pg_catalog.count(*) filter (where h.sensitivity = 'S2')::integer
      into v_records, v_s2
      from (select r.*, pg_catalog.row_number() over () as ord
              from public.app_ledger_search(v_q, null, v_org, v_topic, p_from, p_to, 'S2', 'work', false, v_limit) r) h;
  end if;
  perform private.app_mcp_gate_done('ledger_search', pg_catalog.jsonb_array_length(v_records), v_s2);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', pg_catalog.jsonb_array_length(v_records) >= v_limit,
    'withheld', pg_catalog.jsonb_build_object('s2_summaries', v_s2));
end
$$;
revoke all on function public.app_mcp_ledger_search(text, text, text, date, date, integer) from public, anon, service_role;
grant execute on function public.app_mcp_ledger_search(text, text, text, date, date, integer) to authenticated;

-- ledger_get: 원장 한 건(업무 범위). S2면 ID·종류·기준일·제목·유효상태만.
-- S0·S1이면 요지 앞 300자·중요도·주제·조직 이름·S0·S1 출처의 ID·제목·종류·날짜·연결 기록(ID·제목·관계)·연결 프로젝트 이름.
-- 감사 기록·후보·수정 요청·가져오기 묶음·출처 위치·Drive 파일 ID·메모·결정 이유·상대측은 없음.
create function public.app_mcp_ledger_get(p_ledger_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text := private.app_mcp_arg(p_ledger_id, 20);
  v_ws uuid;
  v_r public.app_ledger_records%rowtype;
  v_records jsonb := '[]'::jsonb;
  v_withheld integer := 0;
  v_hidden_sources integer := 0;
begin
  if v_id is null or v_id !~ '^[A-Z]{2,5}-[0-9]{1,6}$' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('ledger_get');
  select r.* into v_r from public.app_ledger_records r
   where r.workspace_id = v_ws and r.ledger_id = v_id and r.scope = 'work';
  if found then
    if v_r.sensitivity = 'S2' then
      v_withheld := 1;
      v_records := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', 'ledger', 'ledger_id', v_r.ledger_id, 'kind', v_r.kind, 'date', v_r.date_start,
        'title', private.app_mcp_clip(v_r.title, 300), 'validity', v_r.validity, 'sensitivity', 'S2'));
    else
      select pg_catalog.count(*)::integer into v_hidden_sources
        from public.app_ledger_record_sources rs join public.app_ledger_sources s on s.id = rs.source_id
       where rs.record_id = v_r.id and (s.sensitivity = 'S2' or s.status <> 'active');
      v_withheld := v_hidden_sources;
      v_records := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', 'ledger', 'ledger_id', v_r.ledger_id, 'kind', v_r.kind, 'date', v_r.date_start, 'end_date', v_r.date_end,
        'date_precision', v_r.date_precision, 'title', private.app_mcp_clip(v_r.title, 300), 'validity', v_r.validity,
        'sensitivity', v_r.sensitivity, 'importance', v_r.importance, 'summary', private.app_mcp_clip(v_r.summary, 300),
        'topic', (select private.app_mcp_clip(t.name, 80) from public.app_ledger_topics t where t.id = v_r.topic_id),
        'superseded_by', (select x.ledger_id from public.app_ledger_records x where x.id = v_r.superseded_by),
        'organizations', coalesce((select pg_catalog.jsonb_agg(distinct private.app_mcp_clip(o.name, 120))
                                     from public.app_ledger_links l join public.app_ledger_organizations o on o.id = l.target_organization_id
                                    where l.record_id = v_r.id), '[]'::jsonb),
        'projects', coalesce((select pg_catalog.jsonb_agg(distinct private.app_mcp_clip(s.name, 100))
                                from public.app_ledger_links l join public.app_spaces s on s.id = l.target_project_id
                               where l.record_id = v_r.id), '[]'::jsonb),
        'sources', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'ledger_id', s.ledger_id, 'title', private.app_mcp_clip(s.title, 300), 'doc_type', s.doc_type, 'date', s.source_date)
                                order by s.source_date desc nulls last, s.ledger_id)
                               from public.app_ledger_record_sources rs join public.app_ledger_sources s on s.id = rs.source_id
                              where rs.record_id = v_r.id and s.sensitivity <> 'S2' and s.status = 'active'), '[]'::jsonb),
        'links', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                              'ledger_id', x.ledger_id, 'title', private.app_mcp_clip(x.title, 300), 'relation', l.relation,
                              'direction', case when l.record_id = v_r.id then 'to' else 'from' end)
                              order by x.ledger_id)
                             from public.app_ledger_links l
                             join public.app_ledger_records x
                               on x.id = case when l.record_id = v_r.id then l.target_record_id else l.record_id end
                            where (l.record_id = v_r.id and l.target_record_id is not null) or l.target_record_id = v_r.id), '[]'::jsonb)));
    end if;
  end if;
  perform private.app_mcp_gate_done('ledger_get', pg_catalog.jsonb_array_length(v_records), v_withheld);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false,
    'withheld', pg_catalog.jsonb_build_object('s2_summaries', case when v_r.sensitivity = 'S2' then 1 else 0 end,
      's2_sources', v_hidden_sources));
end
$$;
revoke all on function public.app_mcp_ledger_get(text) from public, anon, service_role;
grant execute on function public.app_mcp_ledger_get(text) to authenticated;

-- web2_notes_search: 노트(kind 'note'만, 휴지통 제외) 제목·폴더 이름·수정일·본문 앞 200자(명진 결정 D2).
-- 일기·정리함·업무일지·첨부·댓글은 없음. AI 내보내기 금지 노트와 잠근 폴더(하위 포함, 이름만 적힌 옛 노트 포함)의 노트는 제목도 내지 않는다.
create function public.app_mcp_notes_search(p_query text, p_folder text default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_folder text := private.app_mcp_arg(p_folder, 50);
  v_limit integer := coalesce(p_limit, 20);
  v_ws uuid;
  v_words text[];
  v_locks jsonb;
  v_covered uuid[];
  v_top_names text[];
  v_records jsonb;
  v_total integer;
begin
  if v_q is null or v_limit < 1 or v_limit > 50 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_notes_search');
  select coalesce(pg_catalog.array_agg(w), '{}') into v_words
    from (select distinct w from pg_catalog.unnest(pg_catalog.regexp_split_to_array(pg_catalog.lower(v_q), '\s+')) w
           where w <> '' limit 6) x;
  v_locks := coalesce(private.app_mcp_note_locks(), '{}'::jsonb);
  select coalesce(pg_catalog.array_agg(e::uuid), '{}') into v_covered
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'covered', '[]'::jsonb)) e;
  select coalesce(pg_catalog.array_agg(e), '{}') into v_top_names
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'top_names', '[]'::jsonb)) e;

  with base as (
    select n.id, n.title, n.raw_text, coalesce(n.updated_at, n.occurred_at) as at,
           case when n.metadata ->> 'folder_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (n.metadata ->> 'folder_id')::uuid end as folder_id,
           nullif(pg_catalog.btrim(coalesce(n.metadata ->> 'folder', '')), '') as folder_label
      from public.app_notes n
     where n.workspace_id = v_ws and n.kind = 'note' and n.deleted_at is null and n.ai_export_allowed is true
  ), shaped as (
    select b.id, b.title, b.raw_text, b.at, b.folder_id,
           coalesce((select f.name from public.app_note_folders f where f.id = b.folder_id and f.workspace_id = v_ws), b.folder_label) as folder_name
      from base b
     where not (b.folder_id is not null and b.folder_id = any (v_covered))
       and not (b.folder_id is null and b.folder_label is not null and b.folder_label = any (v_top_names))
  ), hits as (
    select s.* from shaped s
     where (v_folder is null or pg_catalog.lower(coalesce(s.folder_name, '')) = pg_catalog.lower(v_folder))
       and (select pg_catalog.bool_and(pg_catalog.strpos(pg_catalog.lower(coalesce(s.title, '') || ' ' || coalesce(s.raw_text, '')), w) > 0)
              from pg_catalog.unnest(v_words) w) is not false
  )
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'note', 'id', k.id,
             'title', private.app_mcp_clip(coalesce(nullif(pg_catalog.btrim(k.title), ''),
                        pg_catalog.split_part(pg_catalog.btrim(coalesce(k.raw_text, '')), pg_catalog.chr(10), 1)), 100),
             'folder', private.app_mcp_clip(k.folder_name, 40),
             'date', (k.at at time zone 'Asia/Seoul')::date,
             'text', private.app_mcp_clip(k.raw_text, 200)) order by k.at desc, k.id)
           from (select h2.* from hits h2 order by h2.at desc, h2.id limit v_limit) k), '[]'::jsonb)
    into v_total, v_records
    from hits;
  perform private.app_mcp_gate_done('web2_notes_search', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > v_limit,
    'withheld', pg_catalog.jsonb_build_object('excluded_kinds', pg_catalog.jsonb_build_array('diary', 'basket', 'work', 'call', 'transcript', 'family')));
end
$$;
revoke all on function public.app_mcp_notes_search(text, text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_notes_search(text, text, integer) to authenticated;

-- google_where: 할 일·일정은 Google이 원본이다. Web2 설정에 적힌 보고 캘린더 이름만 알려 주고 일정·할 일 내용·ID·날짜는 내지 않는다.
create function public.app_mcp_google_where()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
  v_calendar text;
  v_records jsonb;
begin
  v_ws := private.app_mcp_gate('google_where');
  select private.app_mcp_clip(p.view_prefs ->> 'report_calendar', 60) into v_calendar
    from public.app_profiles p where p.user_id = (select auth.uid());
  v_records := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'type', 'google_where',
    'calendars', case when v_calendar is null then '[]'::jsonb else pg_catalog.jsonb_build_array(v_calendar) end,
    'guide', 'Web2는 일정과 할 일을 복사해 두지 않습니다. 일정은 Claude의 Google Calendar 커넥터에서 위 캘린더 이름으로, 할 일은 Google Tasks에서 보세요.'));
  perform private.app_mcp_gate_done('google_where', 1, 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object());
end
$$;
revoke all on function public.app_mcp_google_where() from public, anon, service_role;
grant execute on function public.app_mcp_google_where() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261120090000', 'mcp_claude_read', array['MCP Claude read M-3: 2 new tables app_mcp_settings (owner select, column update enabled/revoked_before/updated_at, no update with a delegated client_id token, allowed_client_id SQL only) and app_mcp_read_log (owner select only, writes by the gate); private SECURITY DEFINER gate app_mcp_gate (client_id equals the allowed client, sole owner workspace, enabled, revoked_before against auth.sessions, 20 per minute and 300 per KST day, one log row), gate_done and note lock list helpers, invoker clip/arg helpers; 7 public SECURITY INVOKER read RPCs app_mcp_* with fixed column allow lists (no diary, basket, work journal, call, transcript, telegram, outside, family or other product tables; ledger S2 title only); authenticated execute only; no existing table, policy, grant, function or row changed; pre-request function and storage policy are a separate SQL Editor file']);
commit;
