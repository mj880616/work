begin;
-- MCP-Claude읽기 3판(설계 docs/design/mcp-claude-read.md 15절). 사용자 결정 D5(2026-11-27): 2판이 '읽지 않음'으로 둔 다섯 영역 —
-- 하루 기록(일기·업무일지 줄), 통화, 녹음(회의 기록), 정리함(바구니) 원문, 가족 방 — 을 영역 스위치 뒤에서 읽기만 한다. 가족 방은 기본 꺼짐.
--
-- 무엇:
--   설정 표 app_mcp_settings에 영역 칸 5개(area_diary·area_calls·area_recordings·area_basket 기본 켬, area_family 기본 끔).
--     화면(일반 로그인 열쇠)만 고친다: 칸 단위 고치기 권한 + 기존 고치기 정책(위임 열쇠 client_id 있으면 거절)이 그대로 걸린다.
--   기록 표 app_mcp_read_log의 도구 이름 검사를 7개 → 17개로(자료 칸·권한 그대로).
--   문지기 private.app_mcp_gate 교체(같은 이름·같은 인자·같은 DEFINER·같은 권한). 2판 검사 1~6은 한 줄도 빼지 않고,
--     새 도구에는 영역 스위치·운영자 기능(통화 calls·가족 family)·앱 잠금(일기·통화) 확인을 더한다(거절 AREA_OFF·NOT_ALLOWED).
--   도우미 private.app_mcp_locked_areas(DEFINER, 잠금 표에서 내 잠금 영역 이름만 — 비밀번호 칸은 읽지 않음, 실행권 없음: 문지기만 부름),
--     private.app_mcp_text·app_mcp_page·app_mcp_words·app_mcp_hit·app_mcp_uuid·app_mcp_period(INVOKER, 글 정리·쪽 나누기·검색어·입력 검사).
--   읽기 함수 public.app_mcp_* 10개(입구 mcp-read 새 도구와 1:1, 목록·검색 + 한 건 읽기). 본문은 한 쪽 8,000자.
-- 보안(AGENTS.md 3절):
--   - 읽기 함수는 SECURITY INVOKER + search_path ''. 기존 owner RLS와 운영자 기능 restrictive 읽기 정책이 그대로 걸린다(권한을 넓히지 않음).
--     문지기를 먼저 통과해야 하고, 작업공간·사용자 값을 입력으로 받지 않는다(다른 작업공간·묶음 공유는 읽지 않음).
--   - 새 표·새 anon·PUBLIC 권한·새 비밀값 없음. 실행권은 authenticated만. service_role 실행권 없음.
--   - 계속 빼는 것: 텔레그램 대화 원문·바깥 수집, 다른 제품 표, 사진·첨부 내용과 Drive 파일 ID·바깥 주소, 진행 중 전사 작업,
--     숨긴 통화·휴지통, 정리함의 'AI 재료에서 빼기' 행·잠근 노트 폴더 행(D6).
--   - 기존 표·정책·자료·다른 함수는 바꾸지 않는다. 2판 읽기 함수 7개·도우미 4개도 그대로다.
-- 거절 문구(입구 core.mjs mapRpcFailure와 맞춤): NOT_ALLOWED·DISCONNECTED·AREA_OFF(PT403)·RATE_LIMITED(PT429)·BAD_INPUT(22023)·NOT_FOUND 대신 빈 records.
-- 요청 전 함수(L1)의 허용 이름 목록은 SQL Editor 파일 docs/ops/mcp-claude-read-guard-areas.*.sql로 넓힌다(승인형 workflow 규칙 밖 모양).
-- 짝: docs/20261127120000_mcp_claude_read_areas.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261120090000' and name = 'mcp_claude_read') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261119200000' and name = 'feature_pin_lock') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_mcp_gate(text)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or to_regprocedure('private.app_mcp_note_locks()') is null
     or to_regprocedure('private.app_mcp_gate_done(text,integer,integer)') is null
     or to_regprocedure('private.app_mcp_clip(text,integer)') is null
     or to_regprocedure('private.app_mcp_arg(text,integer)') is null
     or to_regclass('public.app_feature_locks') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_call_personal') is null
     or to_regclass('public.app_call_edits') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_family_notes') is null
     or (select count(*) from pg_attribute a where a.attrelid = to_regclass('public.app_mcp_settings') and not a.attisdropped
          and a.attname like 'area\_%') <> 0
     or (select count(*) from pg_constraint c where c.conrelid = to_regclass('public.app_mcp_read_log') and c.conname = 'app_mcp_read_log_tool_check') <> 1
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private')
                   and p.proname in ('app_mcp_locked_areas', 'app_mcp_text', 'app_mcp_page', 'app_mcp_words', 'app_mcp_hit', 'app_mcp_uuid', 'app_mcp_period',
                     'app_mcp_day_list', 'app_mcp_day_get', 'app_mcp_calls_list', 'app_mcp_call_get', 'app_mcp_recordings_list', 'app_mcp_recording_get',
                     'app_mcp_basket_search', 'app_mcp_basket_get', 'app_mcp_family_list', 'app_mcp_family_get'))
     or (select count(*) from (values
          ('app_notes', 'journal_day'), ('app_notes', 'attachments'), ('app_notes', 'kind'), ('app_notes', 'raw_text'), ('app_notes', 'deleted_at'),
          ('app_notes', 'archived_at'), ('app_notes', 'occurred_at'), ('app_notes', 'metadata'), ('app_notes', 'title'), ('app_notes', 'ai_export_allowed'),
          ('app_feed_items', 'source'), ('app_feed_items', 'day'), ('app_feed_items', 'title'), ('app_feed_items', 'summary'), ('app_feed_items', 'points'),
          ('app_feed_items', 'counterpart'), ('app_feed_items', 'raw_text'), ('app_feed_items', 'hidden_at'), ('app_feed_items', 'archived_at'), ('app_feed_items', 'occurred_at'),
          ('app_call_personal', 'kind'), ('app_call_personal', 'day'), ('app_call_personal', 'title'), ('app_call_personal', 'summary'), ('app_call_personal', 'points'),
          ('app_call_personal', 'counterpart'), ('app_call_personal', 'raw_text'), ('app_call_personal', 'hidden_at'), ('app_call_personal', 'occurred_at'),
          ('app_call_edits', 'call_id'), ('app_call_edits', 'vals'),
          ('app_meetings', 'title'), ('app_meetings', 'meeting_at'), ('app_meetings', 'created_at'), ('app_meetings', 'transcript_text'), ('app_meetings', 'notes'),
          ('app_meetings', 'decisions'), ('app_meetings', 'deleted_at'), ('app_meetings', 'workspace_id'),
          ('app_family_notes', 'kind'), ('app_family_notes', 'body'), ('app_family_notes', 'said_when'), ('app_family_notes', 'firmness'), ('app_family_notes', 'origin'),
          ('app_family_notes', 'origin_day'), ('app_family_notes', 'status'), ('app_family_notes', 'created_at'),
          ('app_feature_locks', 'user_id'), ('app_feature_locks', 'features')) v(t, c)
          join pg_attribute a on a.attrelid = to_regclass('public.' || v.t) and a.attname = v.c and not a.attisdropped) <> 49 then
    raise exception 'MCP_CLAUDE_READ_AREAS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 표 칸 -------------------------------------------------------------------------------------------

alter table public.app_mcp_settings
  add column area_diary boolean not null default true,
  add column area_calls boolean not null default true,
  add column area_recordings boolean not null default true,
  add column area_basket boolean not null default true,
  add column area_family boolean not null default false;
grant update (area_diary, area_calls, area_recordings, area_basket, area_family) on table public.app_mcp_settings to authenticated;

alter table public.app_mcp_read_log drop constraint app_mcp_read_log_tool_check;
alter table public.app_mcp_read_log add constraint app_mcp_read_log_tool_check check (tool in ('web2_org_status', 'web2_business_reports', 'web2_project_status',
  'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where',
  'web2_day_list', 'web2_day_get', 'web2_calls_list', 'web2_call_get', 'web2_recordings_list', 'web2_recording_get',
  'web2_basket_search', 'web2_basket_get', 'web2_family_list', 'web2_family_get'));

-- private 도우미 -------------------------------------------------------------------------------------

-- 내 앱 잠금(비밀번호 잠금) 영역 중 일기·통화만. 잠금 표는 API 역할에 닫혀 있어 DEFINER로 읽는다(비밀번호 칸은 읽지 않음). 문지기만 부른다.
create function private.app_mcp_locked_areas()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select pg_catalog.array_agg(x order by x) from public.app_feature_locks l cross join lateral pg_catalog.unnest(l.features) x
                    where l.user_id = (select auth.uid()) and x in ('diary', 'calls')), '{}'::text[])
$$;
revoke all on function private.app_mcp_locked_areas() from public, anon, authenticated, service_role;

-- 문지기 교체. 2판 검사 1~6 그대로 + 새 도구의 영역 확인(스위치·운영자 기능·앱 잠금). 이름·인자·DEFINER·권한 같음.
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
  v_area text;
  v_area_on boolean;
  v_s public.app_mcp_settings%rowtype;
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
begin
  v_client := coalesce(v_claims ->> 'client_id', '');
  v_session := coalesce(v_claims ->> 'session_id', '');
  if p_tool is null or p_tool not in ('web2_org_status', 'web2_business_reports', 'web2_project_status',
      'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where',
      'web2_day_list', 'web2_day_get', 'web2_calls_list', 'web2_call_get', 'web2_recordings_list', 'web2_recording_get',
      'web2_basket_search', 'web2_basket_get', 'web2_family_list', 'web2_family_get') then
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
  select s.* into v_s
    from public.app_mcp_settings s
   where s.workspace_id = v_ws
     for update;
  v_enabled := v_s.enabled;
  v_allowed := v_s.allowed_client_id;
  v_revoked := v_s.revoked_before;
  if v_s.workspace_id is null or v_allowed is null or v_allowed <> v_client then
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
  -- 4-1(3판). 영역 도구: 영역 스위치·운영자 기능·앱 잠금.
  v_area := case
    when p_tool in ('web2_day_list', 'web2_day_get') then 'diary'
    when p_tool in ('web2_calls_list', 'web2_call_get') then 'calls'
    when p_tool in ('web2_recordings_list', 'web2_recording_get') then 'recordings'
    when p_tool in ('web2_basket_search', 'web2_basket_get') then 'basket'
    when p_tool in ('web2_family_list', 'web2_family_get') then 'family'
  end;
  if v_area is not null then
    if (v_area = 'calls' and not private.app_workspace_has_feature(v_ws, 'calls'))
       or (v_area = 'family' and not private.app_workspace_has_feature(v_ws, 'family')) then
      raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
    end if;
    v_area_on := case v_area
      when 'diary' then v_s.area_diary when 'calls' then v_s.area_calls when 'recordings' then v_s.area_recordings
      when 'basket' then v_s.area_basket when 'family' then v_s.area_family end;
    if v_area_on is not true or v_area = any (private.app_mcp_locked_areas()) then
      raise exception using errcode = 'PT403', message = 'AREA_OFF';
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

-- 긴 글 칸 정리: 줄바꿈·탭은 두고 다른 제어 문자는 빈칸, 앞뒤 빈칸 제거, 길이 상한(최대 8,000).
create function private.app_mcp_text(p_text text, p_max integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0b-\x1f\x7f]+', ' ', 'g'), E' \n\t'),
    greatest(1, least(coalesce(p_max, 8000), 8000))), '')
$$;
revoke all on function private.app_mcp_text(text, integer) from public, anon, service_role;
grant execute on function private.app_mcp_text(text, integer) to authenticated;

-- 쪽 나누기: 한 쪽 8,000자. {text, page, pages, length}. 쪽이 범위 밖이면 text 없음.
create function private.app_mcp_page(p_text text, p_page integer)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  with t as (select pg_catalog.regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0b-\x1f\x7f]+', ' ', 'g') as s)
  select pg_catalog.jsonb_build_object(
    'text', case when coalesce(p_page, 1) between 1 and greatest(1, (pg_catalog.char_length(t.s) + 7999) / 8000)
                 then nullif(pg_catalog.substr(t.s, (coalesce(p_page, 1) - 1) * 8000 + 1, 8000), '') end,
    'page', coalesce(p_page, 1),
    'pages', greatest(1, (pg_catalog.char_length(t.s) + 7999) / 8000),
    'length', pg_catalog.char_length(t.s))
    from t
$$;
revoke all on function private.app_mcp_page(text, integer) from public, anon, service_role;
grant execute on function private.app_mcp_page(text, integer) to authenticated;

-- 검색어 → 낱말(소문자, 최대 6개). 빈 검색어는 빈 목록.
create function private.app_mcp_words(p_query text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce((select pg_catalog.array_agg(w) from (select distinct w from pg_catalog.unnest(
      pg_catalog.regexp_split_to_array(pg_catalog.lower(coalesce(p_query, '')), '\s+')) w where w <> '' limit 6) x), '{}'::text[])
$$;
revoke all on function private.app_mcp_words(text) from public, anon, service_role;
grant execute on function private.app_mcp_words(text) to authenticated;

-- 낱말이 모두 들어 있나(낱말이 없으면 참).
create function private.app_mcp_hit(p_hay text, p_words text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce((select pg_catalog.bool_and(pg_catalog.strpos(pg_catalog.lower(coalesce(p_hay, '')), w) > 0)
                     from pg_catalog.unnest(coalesce(p_words, '{}'::text[])) w), true)
$$;
revoke all on function private.app_mcp_hit(text, text[]) from public, anon, service_role;
grant execute on function private.app_mcp_hit(text, text[]) to authenticated;

-- 입력 uuid 검사(모양이 아니면 BAD_INPUT).
create function private.app_mcp_uuid(p_text text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := pg_catalog.lower(coalesce(private.app_mcp_arg(p_text, 36), ''));
begin
  if v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return v::uuid;
end
$$;
revoke all on function private.app_mcp_uuid(text) from public, anon, service_role;
grant execute on function private.app_mcp_uuid(text) to authenticated;

-- 기간 검사: 기본 최근 p_default일(KST), 최대 92일, 거꾸로면 BAD_INPUT. [from, to].
create function private.app_mcp_period(p_from date, p_to date, p_default integer)
returns date[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (pg_catalog.now() at time zone 'Asia/Seoul')::date);
  v_from date := coalesce(p_from, v_to - (greatest(1, least(coalesce(p_default, 30), 92)) - 1));
begin
  if v_from > v_to or v_to - v_from > 91 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  return array[v_from, v_to];
end
$$;
revoke all on function private.app_mcp_period(date, date, integer) from public, anon, service_role;
grant execute on function private.app_mcp_period(date, date, integer) to authenticated;

-- 검사 순서 공통: 입력 검사(BAD_INPUT, 셈에 안 들어감) → 문지기 → 읽기 → 건수 기록. "없음"은 빈 records.

-- 읽기 함수: 하루 기록 ------------------------------------------------------------------------------

-- web2_day_list: 일기(kind diary)·업무일지(kind work) 날짜 목록. 일기 앞 200자·글자 수, 업무일지 줄 수, 사진 수. 기본 최근 14일.
create function public.app_mcp_day_list(p_from date default null, p_to date default null, p_query text default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_limit integer := coalesce(p_limit, 20);
  v_period date[];
  v_words text[];
  v_ws uuid;
  v_records jsonb;
  v_total integer;
begin
  if v_limit < 1 or v_limit > 50 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_period := private.app_mcp_period(p_from, p_to, 14);
  v_words := private.app_mcp_words(v_q);
  v_ws := private.app_mcp_gate('web2_day_list');
  with days as (
    select n.journal_day as day,
           pg_catalog.max(case when n.kind = 'diary' then n.raw_text end) as diary,
           pg_catalog.max(case when n.kind = 'work' then n.raw_text end) as work,
           coalesce(pg_catalog.sum(case when n.kind = 'diary' then (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
             case when pg_catalog.jsonb_typeof(n.attachments) = 'array' then n.attachments else '[]'::jsonb end) a
             where coalesce(a ->> 'mime_type', '') like 'image/%') end), 0)::integer as photos
      from public.app_notes n
     where n.workspace_id = v_ws and n.kind in ('diary', 'work') and n.deleted_at is null
       and n.journal_day between v_period[1] and v_period[2]
     group by n.journal_day
  ), hits as (
    select d.* from days d where private.app_mcp_hit(coalesce(d.diary, '') || ' ' || coalesce(d.work, ''), v_words)
  )
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'day', 'date', k.day,
             'diary_preview', private.app_mcp_clip(k.diary, 200),
             'diary_length', pg_catalog.char_length(coalesce(k.diary, '')),
             'work_line_count', (select pg_catalog.count(*) from pg_catalog.regexp_split_to_table(coalesce(k.work, ''), E'\n') x where pg_catalog.btrim(x) <> ''),
             'photo_count', k.photos) order by k.day desc)
           from (select h2.* from hits h2 order by h2.day desc limit v_limit) k), '[]'::jsonb)
    into v_total, v_records
    from hits;
  perform private.app_mcp_gate_done('web2_day_list', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > v_limit, 'withheld', pg_catalog.jsonb_build_object(),
    'untrusted_text', true, 'period', pg_catalog.jsonb_build_object('from', v_period[1], 'to', v_period[2]));
end
$$;
revoke all on function public.app_mcp_day_list(date, date, text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_day_list(date, date, text, integer) to authenticated;

-- web2_day_get: 한 날. 일기 본문(쪽 나눔), 업무일지 줄 전부(줄당 300자, 50줄), 사진 수·파일 이름(최대 20). 그날 끝낸 할 일은 DB에 없다(Google Tasks).
create function public.app_mcp_day_get(p_day date, p_page integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page integer := coalesce(p_page, 1);
  v_ws uuid;
  v_has_diary boolean := false;
  v_has_work boolean := false;
  v_diary text;
  v_photos jsonb := '[]'::jsonb;
  v_work text;
  v_records jsonb := '[]'::jsonb;
begin
  if p_day is null or p_day < date '2000-01-01' or p_day > date '2100-12-31' or v_page < 1 or v_page > 200 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_day_get');
  select n.raw_text, case when pg_catalog.jsonb_typeof(n.attachments) = 'array' then n.attachments else '[]'::jsonb end
    into v_diary, v_photos from public.app_notes n
   where n.workspace_id = v_ws and n.kind = 'diary' and n.journal_day = p_day and n.deleted_at is null limit 1;
  v_has_diary := found;
  select n.raw_text into v_work from public.app_notes n
   where n.workspace_id = v_ws and n.kind = 'work' and n.journal_day = p_day and n.deleted_at is null limit 1;
  v_has_work := found;
  v_photos := coalesce(v_photos, '[]'::jsonb);
  if v_has_diary or v_has_work then
    v_records := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type', 'day', 'date', p_day,
      'diary', case when v_has_diary then private.app_mcp_page(v_diary, v_page) end,
      'work_lines', coalesce((select pg_catalog.jsonb_agg(private.app_mcp_clip(x.line, 300) order by x.ord)
                                from (select l.line, l.ord from pg_catalog.regexp_split_to_table(coalesce(v_work, ''), E'\n') with ordinality l(line, ord)
                                       where pg_catalog.btrim(l.line) <> '' order by l.ord limit 50) x), '[]'::jsonb),
      'photo_count', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_photos) a
                       where coalesce(a ->> 'mime_type', '') like 'image/%'),
      'photo_names', coalesce((select pg_catalog.jsonb_agg(private.app_mcp_clip(a.v ->> 'file_name', 120) order by a.ord)
                                 from (select e.v, e.ord from pg_catalog.jsonb_array_elements(v_photos) with ordinality e(v, ord)
                                        where coalesce(e.v ->> 'mime_type', '') like 'image/%' order by e.ord limit 20) a), '[]'::jsonb),
      'done_tasks', 'Web2는 그날 끝낸 할 일을 저장하지 않습니다. Google Tasks 커넥터에서 그날 완료한 할 일을 보세요.'));
  end if;
  perform private.app_mcp_gate_done('web2_day_get', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_day_get(date, integer) from public, anon, service_role;
grant execute on function public.app_mcp_day_get(date, integer) to authenticated;

-- 읽기 함수: 통화 ---------------------------------------------------------------------------------

-- web2_calls_list: 업무 통화(app_feed_items source call)·개인·애매 통화 상자. 숨긴 통화 제외. 사용자가 고친 제목·상대 표기를 먼저 쓴다.
-- 번호(저장 안 됨)·연락처 해시·Drive 주소 없음. 운영자 기능 calls는 문지기와 표 정책(INVOKER) 두 겹.
create function public.app_mcp_calls_list(p_from date default null, p_to date default null, p_query text default null,
  p_box text default 'all', p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_box text := coalesce(private.app_mcp_arg(p_box, 10), 'all');
  v_limit integer := coalesce(p_limit, 20);
  v_period date[];
  v_words text[];
  v_ws uuid;
  v_records jsonb;
  v_total integer;
begin
  if v_limit < 1 or v_limit > 50 or v_box not in ('all', 'work', 'personal', 'unsure') then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_period := private.app_mcp_period(p_from, p_to, 30);
  v_words := private.app_mcp_words(v_q);
  v_ws := private.app_mcp_gate('web2_calls_list');
  with calls as (
    select f.id, f.day, f.occurred_at, 'work'::text as box, f.title, f.summary, f.counterpart, f.raw_text, f.archived_at is not null as archived
      from public.app_feed_items f
     where f.workspace_id = v_ws and f.source = 'call' and f.hidden_at is null and f.day between v_period[1] and v_period[2]
    union all
    select c.id, c.day, c.occurred_at, c.kind, c.title, c.summary, c.counterpart, c.raw_text, false
      from public.app_call_personal c
     where c.workspace_id = v_ws and c.hidden_at is null and c.day between v_period[1] and v_period[2]
  ), shaped as (
    select k.id, k.day, k.occurred_at, k.box, k.archived, k.raw_text, k.summary,
           coalesce(nullif(e.vals ->> 'title', ''), k.title) as title,
           coalesce(nullif(e.vals ->> 'counterpart', ''), k.counterpart) as counterpart
      from calls k left join public.app_call_edits e on e.call_id = k.id and e.workspace_id = v_ws
     where v_box = 'all' or k.box = v_box
  ), hits as (
    select s.* from shaped s
     where private.app_mcp_hit(pg_catalog.concat_ws(' ', s.title, s.counterpart, s.summary, s.raw_text), v_words)
  )
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'call', 'id', k.id, 'date', k.day, 'box', k.box, 'archived', k.archived,
             'title', private.app_mcp_clip(k.title, 80), 'counterpart', private.app_mcp_clip(k.counterpart, 100),
             'summary', private.app_mcp_clip(k.summary, 400), 'transcript_length', pg_catalog.char_length(coalesce(k.raw_text, '')))
             order by k.occurred_at desc, k.id)
           from (select h2.* from hits h2 order by h2.occurred_at desc, h2.id limit v_limit) k), '[]'::jsonb)
    into v_total, v_records
    from hits;
  perform private.app_mcp_gate_done('web2_calls_list', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > v_limit, 'withheld', pg_catalog.jsonb_build_object(),
    'untrusted_text', true, 'period', pg_catalog.jsonb_build_object('from', v_period[1], 'to', v_period[2]));
end
$$;
revoke all on function public.app_mcp_calls_list(date, date, text, text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_calls_list(date, date, text, text, integer) to authenticated;

-- web2_call_get: 통화 한 건. 제목·상대 표기·요약·요점(8개, 300자)·전사 본문(쪽 나눔).
create function public.app_mcp_call_get(p_call_id text, p_page integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := private.app_mcp_uuid(p_call_id);
  v_page integer := coalesce(p_page, 1);
  v_ws uuid;
  v_records jsonb := '[]'::jsonb;
begin
  if v_page < 1 or v_page > 200 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_call_get');
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'call', 'id', k.id, 'date', k.day, 'box', k.box,
      'title', private.app_mcp_clip(coalesce(nullif(e.vals ->> 'title', ''), k.title), 80),
      'counterpart', private.app_mcp_clip(coalesce(nullif(e.vals ->> 'counterpart', ''), k.counterpart), 100),
      'summary', private.app_mcp_clip(k.summary, 400),
      'points', coalesce((select pg_catalog.jsonb_agg(private.app_mcp_clip(p.v, 300) order by p.ord)
                            from (select x.v, x.ord from pg_catalog.jsonb_array_elements_text(
                                    case when pg_catalog.jsonb_typeof(k.points) = 'array' then k.points else '[]'::jsonb end) with ordinality x(v, ord)
                                   order by x.ord limit 8) p), '[]'::jsonb),
      'transcript', private.app_mcp_page(k.raw_text, v_page))), '[]'::jsonb)
    into v_records
    from (select f.id, f.day, 'work'::text as box, f.title, f.summary, f.counterpart, f.points, f.raw_text
            from public.app_feed_items f
           where f.id = v_id and f.workspace_id = v_ws and f.source = 'call' and f.hidden_at is null
          union all
          select c.id, c.day, c.kind, c.title, c.summary, c.counterpart, c.points, c.raw_text
            from public.app_call_personal c
           where c.id = v_id and c.workspace_id = v_ws and c.hidden_at is null) k
    left join public.app_call_edits e on e.call_id = k.id and e.workspace_id = v_ws;
  perform private.app_mcp_gate_done('web2_call_get', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_call_get(text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_call_get(text, integer) to authenticated;

-- 읽기 함수: 녹음(회의 기록) -------------------------------------------------------------------------

-- web2_recordings_list: 회의 기록(휴지통 제외) 중 회의록 전문(notes)이나 회의 결과 글(transcript_text)이 있는 것.
-- 진행 중 전사 작업·녹음 조각·Drive 파일 ID·참석자 칸은 없음.
create function public.app_mcp_recordings_list(p_from date default null, p_to date default null, p_query text default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_limit integer := coalesce(p_limit, 20);
  v_period date[];
  v_words text[];
  v_ws uuid;
  v_records jsonb;
  v_total integer;
begin
  if v_limit < 1 or v_limit > 50 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_period := private.app_mcp_period(p_from, p_to, 30);
  v_words := private.app_mcp_words(v_q);
  v_ws := private.app_mcp_gate('web2_recordings_list');
  with base as (
    select m.id, coalesce(m.meeting_at, m.created_at) as at, m.title, m.transcript_text, m.notes
      from public.app_meetings m
     where m.workspace_id = v_ws and m.deleted_at is null
       and (pg_catalog.btrim(coalesce(m.notes, '')) <> '' or pg_catalog.btrim(coalesce(m.transcript_text, '')) <> '')
       and (coalesce(m.meeting_at, m.created_at) at time zone 'Asia/Seoul')::date between v_period[1] and v_period[2]
  ), hits as (
    select b.* from base b where private.app_mcp_hit(pg_catalog.concat_ws(' ', b.title, b.transcript_text, b.notes), v_words)
  )
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'recording', 'id', k.id, 'date', (k.at at time zone 'Asia/Seoul')::date,
             'title', private.app_mcp_clip(k.title, 100),
             'result_preview', private.app_mcp_clip(k.transcript_text, 200),
             'transcript_length', pg_catalog.char_length(coalesce(k.notes, ''))) order by k.at desc, k.id)
           from (select h2.* from hits h2 order by h2.at desc, h2.id limit v_limit) k), '[]'::jsonb)
    into v_total, v_records
    from hits;
  perform private.app_mcp_gate_done('web2_recordings_list', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > v_limit, 'withheld', pg_catalog.jsonb_build_object(),
    'untrusted_text', true, 'period', pg_catalog.jsonb_build_object('from', v_period[1], 'to', v_period[2]));
end
$$;
revoke all on function public.app_mcp_recordings_list(date, date, text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_recordings_list(date, date, text, integer) to authenticated;

-- web2_recording_get: 회의 기록 한 건. 제목·날짜·회의 결과 글(4,000자)·결정 사항(2,000자)·회의록 전문(쪽 나눔).
create function public.app_mcp_recording_get(p_meeting_id text, p_page integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := private.app_mcp_uuid(p_meeting_id);
  v_page integer := coalesce(p_page, 1);
  v_ws uuid;
  v_records jsonb := '[]'::jsonb;
begin
  if v_page < 1 or v_page > 200 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_recording_get');
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'recording', 'id', m.id, 'date', (coalesce(m.meeting_at, m.created_at) at time zone 'Asia/Seoul')::date,
      'title', private.app_mcp_clip(m.title, 100),
      'result', private.app_mcp_text(m.transcript_text, 4000),
      'decisions', private.app_mcp_text(m.decisions::text, 2000),
      'transcript', private.app_mcp_page(m.notes, v_page))), '[]'::jsonb)
    into v_records
    from public.app_meetings m
   where m.id = v_id and m.workspace_id = v_ws and m.deleted_at is null;
  perform private.app_mcp_gate_done('web2_recording_get', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_recording_get(text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_recording_get(text, integer) to authenticated;

-- 읽기 함수: 정리함(바구니) -------------------------------------------------------------------------

-- web2_basket_search: 정리함(kind basket, 휴지통 제외, 보류 포함·표시). 'AI 재료에서 빼기' 행과 잠근 노트 폴더 행은 제목도 없음(D6).
create function public.app_mcp_basket_search(p_query text default null, p_from date default null, p_to date default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q text := private.app_mcp_arg(p_query, 100);
  v_limit integer := coalesce(p_limit, 20);
  v_period date[];
  v_words text[];
  v_ws uuid;
  v_locks jsonb;
  v_covered uuid[];
  v_top_names text[];
  v_records jsonb;
  v_total integer;
begin
  if v_limit < 1 or v_limit > 50 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_period := private.app_mcp_period(p_from, p_to, 30);
  v_words := private.app_mcp_words(v_q);
  v_ws := private.app_mcp_gate('web2_basket_search');
  v_locks := coalesce(private.app_mcp_note_locks(), '{}'::jsonb);
  select coalesce(pg_catalog.array_agg(e::uuid), '{}') into v_covered
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'covered', '[]'::jsonb)) e;
  select coalesce(pg_catalog.array_agg(e), '{}') into v_top_names
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'top_names', '[]'::jsonb)) e;
  with base as (
    select n.id, n.occurred_at, n.raw_text, n.archived_at, n.attachments,
           case when n.metadata ->> 'folder_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (n.metadata ->> 'folder_id')::uuid end as folder_id,
           nullif(pg_catalog.btrim(coalesce(n.metadata ->> 'folder', '')), '') as folder_label
      from public.app_notes n
     where n.workspace_id = v_ws and n.kind = 'basket' and n.deleted_at is null and n.ai_export_allowed is true
       and (n.occurred_at at time zone 'Asia/Seoul')::date between v_period[1] and v_period[2]
  ), hits as (
    select b.* from base b
     where not (b.folder_id is not null and b.folder_id = any (v_covered))
       and not (b.folder_id is null and b.folder_label is not null and b.folder_label = any (v_top_names))
       and private.app_mcp_hit(b.raw_text, v_words)
  )
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'basket', 'id', k.id, 'date', (k.occurred_at at time zone 'Asia/Seoul')::date, 'held', k.archived_at is not null,
             'preview', private.app_mcp_clip(k.raw_text, 200), 'length', pg_catalog.char_length(coalesce(k.raw_text, '')),
             'attachment_count', case when pg_catalog.jsonb_typeof(k.attachments) = 'array' then pg_catalog.jsonb_array_length(k.attachments) else 0 end)
             order by k.occurred_at desc, k.id)
           from (select h2.* from hits h2 order by h2.occurred_at desc, h2.id limit v_limit) k), '[]'::jsonb)
    into v_total, v_records
    from hits;
  perform private.app_mcp_gate_done('web2_basket_search', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', v_total > v_limit, 'withheld', pg_catalog.jsonb_build_object(),
    'untrusted_text', true, 'period', pg_catalog.jsonb_build_object('from', v_period[1], 'to', v_period[2]));
end
$$;
revoke all on function public.app_mcp_basket_search(text, date, date, integer) from public, anon, service_role;
grant execute on function public.app_mcp_basket_search(text, date, date, integer) to authenticated;

-- web2_basket_get: 정리함 한 건. 본문(쪽 나눔)·첨부 이름(최대 20)·개수. 첨부 파일 ID·OCR 글 없음.
create function public.app_mcp_basket_get(p_item_id text, p_page integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := private.app_mcp_uuid(p_item_id);
  v_page integer := coalesce(p_page, 1);
  v_ws uuid;
  v_locks jsonb;
  v_covered uuid[];
  v_top_names text[];
  v_records jsonb := '[]'::jsonb;
begin
  if v_page < 1 or v_page > 200 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_basket_get');
  v_locks := coalesce(private.app_mcp_note_locks(), '{}'::jsonb);
  select coalesce(pg_catalog.array_agg(e::uuid), '{}') into v_covered
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'covered', '[]'::jsonb)) e;
  select coalesce(pg_catalog.array_agg(e), '{}') into v_top_names
    from pg_catalog.jsonb_array_elements_text(coalesce(v_locks -> 'top_names', '[]'::jsonb)) e;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'basket', 'id', k.id, 'date', (k.occurred_at at time zone 'Asia/Seoul')::date, 'held', k.archived_at is not null,
      'body', private.app_mcp_page(k.raw_text, v_page),
      'attachment_count', case when pg_catalog.jsonb_typeof(k.attachments) = 'array' then pg_catalog.jsonb_array_length(k.attachments) else 0 end,
      'attachment_names', coalesce((select pg_catalog.jsonb_agg(private.app_mcp_clip(a.v ->> 'file_name', 120) order by a.ord)
                                      from (select e.v, e.ord from pg_catalog.jsonb_array_elements(
                                              case when pg_catalog.jsonb_typeof(k.attachments) = 'array' then k.attachments else '[]'::jsonb end)
                                              with ordinality e(v, ord) order by e.ord limit 20) a), '[]'::jsonb))), '[]'::jsonb)
    into v_records
    from (select n.id, n.occurred_at, n.archived_at, n.raw_text, n.attachments,
                 case when n.metadata ->> 'folder_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then (n.metadata ->> 'folder_id')::uuid end as folder_id,
                 nullif(pg_catalog.btrim(coalesce(n.metadata ->> 'folder', '')), '') as folder_label
            from public.app_notes n
           where n.id = v_id and n.workspace_id = v_ws and n.kind = 'basket' and n.deleted_at is null and n.ai_export_allowed is true) k
   where not (k.folder_id is not null and k.folder_id = any (v_covered))
     and not (k.folder_id is null and k.folder_label is not null and k.folder_label = any (v_top_names));
  perform private.app_mcp_gate_done('web2_basket_get', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_basket_get(text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_basket_get(text, integer) to authenticated;

-- 읽기 함수: 가족 방 (영역 기본 꺼짐, 운영자 기능 family) ---------------------------------------------

-- web2_family_list: 가족 방 잊지 말기 줄(종류·글 150자·말한 때·확실한 정도·출처 종류·날짜·상태)과
-- 가족 '잊지 말기'·'과거 기록' 노트(metadata family_list·family_past)의 제목·앞 200자. 출처 위치·Drive 주소 없음. 기본은 '치움' 줄 제외.
create function public.app_mcp_family_list(p_status text default null, p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text := private.app_mcp_arg(p_status, 12);
  v_limit integer := coalesce(p_limit, 20);
  v_ws uuid;
  v_lines jsonb;
  v_notes jsonb;
  v_total integer;
begin
  if v_limit < 1 or v_limit > 50 or (v_status is not null and v_status not in ('all', 'new', 'kept', 'tasked', 'scheduled', 'dismissed')) then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_family_list');
  select pg_catalog.count(*)::integer,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'type', 'family_line', 'id', k.id, 'kind', k.kind, 'text', private.app_mcp_clip(k.body, 150),
             'said_when', private.app_mcp_clip(k.said_when, 60), 'firmness', k.firmness, 'origin', k.origin,
             'date', k.origin_day, 'status', k.status) order by k.created_at desc, k.id)
           from (select f.* from public.app_family_notes f
                  where f.workspace_id = v_ws
                    and (case when v_status is null then f.status <> 'dismissed' when v_status = 'all' then true else f.status = v_status end)
                  order by f.created_at desc, f.id limit v_limit) k), '[]'::jsonb)
    into v_total, v_lines
    from public.app_family_notes f
   where f.workspace_id = v_ws
     and (case when v_status is null then f.status <> 'dismissed' when v_status = 'all' then true else f.status = v_status end);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'family_note', 'id', k.id, 'list', case when k.metadata ->> 'family_list' = 'true' then 'remember' else 'past' end,
      'title', private.app_mcp_clip(k.title, 100), 'date', (k.updated_at at time zone 'Asia/Seoul')::date,
      'preview', private.app_mcp_clip(k.raw_text, 200), 'length', pg_catalog.char_length(coalesce(k.raw_text, ''))) order by k.updated_at desc, k.id), '[]'::jsonb)
    into v_notes
    from (select n.id, n.title, n.raw_text, n.metadata, n.updated_at from public.app_notes n
           where n.workspace_id = v_ws and n.kind = 'note' and n.deleted_at is null
             and (n.metadata ->> 'family_list' = 'true' or n.metadata ->> 'family_past' = 'true')
           order by n.updated_at desc, n.id limit 10) k;
  perform private.app_mcp_gate_done('web2_family_list', pg_catalog.jsonb_array_length(v_lines) + pg_catalog.jsonb_array_length(v_notes), 0);
  return pg_catalog.jsonb_build_object('records', v_lines || v_notes, 'truncated', v_total > v_limit, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_family_list(text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_family_list(text, integer) to authenticated;

-- web2_family_get: 가족 노트 한 건(쪽 나눔).
create function public.app_mcp_family_get(p_note_id text, p_page integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := private.app_mcp_uuid(p_note_id);
  v_page integer := coalesce(p_page, 1);
  v_ws uuid;
  v_records jsonb := '[]'::jsonb;
begin
  if v_page < 1 or v_page > 200 then
    raise exception using errcode = '22023', message = 'BAD_INPUT';
  end if;
  v_ws := private.app_mcp_gate('web2_family_get');
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', 'family_note', 'id', n.id, 'list', case when n.metadata ->> 'family_list' = 'true' then 'remember' else 'past' end,
      'title', private.app_mcp_clip(n.title, 100), 'date', (n.updated_at at time zone 'Asia/Seoul')::date,
      'body', private.app_mcp_page(n.raw_text, v_page))), '[]'::jsonb)
    into v_records
    from public.app_notes n
   where n.id = v_id and n.workspace_id = v_ws and n.kind = 'note' and n.deleted_at is null
     and (n.metadata ->> 'family_list' = 'true' or n.metadata ->> 'family_past' = 'true');
  perform private.app_mcp_gate_done('web2_family_get', pg_catalog.jsonb_array_length(v_records), 0);
  return pg_catalog.jsonb_build_object('records', v_records, 'truncated', false, 'withheld', pg_catalog.jsonb_build_object(), 'untrusted_text', true);
end
$$;
revoke all on function public.app_mcp_family_get(text, integer) from public, anon, service_role;
grant execute on function public.app_mcp_family_get(text, integer) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127120000', 'mcp_claude_read_areas', array['MCP Claude read 3rd edition (user decision D5): app_mcp_settings gets 5 boolean area columns (diary, calls, recordings, basket default true; family default false) with authenticated column update only (existing update policy still refuses delegated client_id tokens); app_mcp_read_log tool check widened from 7 to 17 names; private.app_mcp_gate replaced with the same name, signature, SECURITY DEFINER, empty search_path and grants, keeping every 2nd edition check and adding area switch, operator feature (calls, family) and app lock (diary, calls) checks for area tools; private DEFINER helper app_mcp_locked_areas with no execute grants (reads only lock area names); 6 private invoker helpers; 10 public SECURITY INVOKER read RPCs app_mcp_* (day list/get, calls list/get, recordings list/get, basket search/get, family list/get) with fixed column allow lists and 8000 character pages, authenticated execute only; no new table, no anon, PUBLIC or service_role privilege, no existing row, policy or other function changed; pre-request allow list widening is a separate SQL Editor file']);
commit;
