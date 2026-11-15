begin;
-- CALL-개인통화함 1단계 DB, 다시 하기(B안: 업무 통화함·개인 통화함 두 개의 함을 별도 표로 둔다. docs/design/call-personal.md).
-- 명진 결정 2026-10-25 16:05: "같은 곳에 표시로 나누지 말고 업무 통화함·개인 통화함 두 개의 함을 따로." 앞서 닫힌 C안(출처 값 분리, app_feed_items.source에 call_personal을 더함)은 쓰지 않는다.
-- 앱·Edge·Apps Script·화면 변경 없음. 운영 적용 직전 정지(승인형 DB workflow 확장 규칙 또는 폰 경로 C).
--
-- 무엇:
--   1) 새 표 public.app_call_personal: 개인 통화(kind='personal')와 아직 정하지 못한 애매 통화(kind='unsure')를 담는 표. 업무 통화는 지금처럼 app_feed_items(source='call')에 둔다.
--      같은 모양(제목·요약·요점·상대·전문·원본 고유키·Drive 주소)이되, 업무 기록으로 이어지는 칸(고정·조직·프로젝트·추천 프로젝트)은 아예 없다.
--      소유자 전용 RLS(private.app_is_workspace_owner), anon·PUBLIC 권한 없음. authenticated는 읽기 + 지우기(hidden_at)·전문 비우기만, service_role은 넣기만.
--   2) app_feed_items에 칸 두 개 moved_at(개인에서 업무로 옮겨 온 시각)·refilled_at(그때 업무 정보를 다시 채운 시각). 기존 줄은 비어 있고 쓰기 권한은 아무에게도 주지 않는다(함수만 쓴다).
--   3) 원본 고유키 중복 방지(양쪽 공통): 같은 통화 원본(workspace_id, source_ref)은 두 표를 통틀어 한 줄만. 각 표의 넣기 전 트리거가 반대 표를 확인한다(같은 키는 직렬화 잠금).
--   4) 함수 둘(public, SECURITY DEFINER, search_path 빈칸, 실행권은 authenticated만, 안에서 소유자 확인):
--      app_call_move(p_id, p_to)      — 한 함에서 다른 함으로 옮긴다('work'|'personal'). 한 트랜잭션 안에서 원본을 지우고 반대 표에 같은 id로 넣는다.
--                                       애매 통화를 'personal'로 정하면 같은 표 안에서 kind만 바꾼다. 'work'로 정하면 업무 통화함으로 옮긴다.
--      app_call_work_info(...)        — 개인에서 업무로 옮긴 직후 한 번만 제목·상대 표기·관련 조직을 채운다(AI 다시 채우기 결과 저장용).
--   5) 트리거 함수 둘(INVOKER, 빈 search_path, 실행권 전부 회수): 위 3)의 중복 확인, 개인 표의 전문 비우기 전용 검사.
-- 안 하는 것: app_feed_items의 기존 칸·CHECK·정책·칸 권한 변경, 기존 트리거(app_feed_items_guard)·함수 본문 교체, anon·PUBLIC 권한, RLS 약화, 기존 줄 변경, 텔레그램 줄 변경, rtw_* 객체.
--   업무 통화를 읽는 모든 곳(원장 자동 기록 등)은 app_feed_items만 읽으므로 코드를 하나도 안 고쳐도 개인 통화가 섞일 수 없다. 이 표를 읽는 곳은 통화 메뉴 화면(3단계)뿐이다.
-- 옮길 때 사라지는 것: 업무→개인은 고정(pinned_at)·조직·프로젝트 연결이 사라진다(개인 표에 칸이 없다). 이미 조직 기록·원장에 쓰인 내용은 지워지지 않는다(원장은 더하기만 하는 규칙).
--   개인→업무는 연결 없이 들어오고 created_at은 원래 값을 유지한다.
-- 짝: docs/20261025200000_call_personal_box.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_feed_items in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025200000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024210000' and name = 'feed_item_guard_public') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_call_personal') is not null
     or to_regprocedure('public.app_call_move(uuid,text)') is not null
     or to_regprocedure('public.app_call_work_info(uuid,text,text,uuid)') is not null
     or to_regprocedure('private.app_call_ref_guard()') is not null
     or to_regprocedure('private.app_call_personal_guard()') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     -- 앞 단계의 트리거 함수는 이 migration이 손대지 않는다. 있는 그대로여야 한다.
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_item_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%private.%' and prosrc like '%FEED_LINK_SCOPE%') <> 1
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_feed_items') and not tgisinternal) <> 1
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_items') and not attisdropped and attname in ('moved_at', 'refilled_at'))
     -- source 값 목록은 그대로(call·telegram뿐, C안 흔적 없음).
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_feed_items') and conname = 'app_feed_items_source_check'
         and pg_get_constraintdef(oid) not like '%call_personal%')
     -- authenticated는 넣기·지우기·source 쓰기 없음, anon·PUBLIC 표 권한 없음, RLS 켜짐(force 꺼짐: 함수가 소유자 권한으로 지우고 넣는다).
     or has_table_privilege('authenticated', 'public.app_feed_items', 'insert')
     or has_table_privilege('authenticated', 'public.app_feed_items', 'delete')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'source', 'update')
     or (select count(*) from pg_class where oid = to_regclass('public.app_feed_items') and relrowsecurity and not relforcerowsecurity
         and coalesce(relacl::text, '') !~ '(^|[{,])(anon)?=') <> 1
     -- service_role는 중복 확인용 읽기 세 칸을 이미 가진다(새 트리거가 같은 칸을 읽는다).
     or not has_column_privilege('service_role', 'public.app_feed_items', 'workspace_id', 'select')
     or not has_column_privilege('service_role', 'public.app_feed_items', 'source', 'select')
     or not has_column_privilege('service_role', 'public.app_feed_items', 'source_ref', 'select')
     -- 적용하는 역할이 표의 소유자이거나 RLS를 건너뛴다(함수의 소유자가 된다).
     or (select count(*) from pg_class c join pg_roles r on r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner)
         where c.oid = to_regclass('public.app_feed_items')) <> 1 then
    raise exception 'CALL_PERSONAL_BOX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 개인 통화함 표. 통화 한 건이 한 줄. 바깥에서 온 글(title·summary·points·counterpart·raw_text)은 화면에서 글자로만 그린다.
-- kind: 'personal' 개인 통화, 'unsure' 아직 정하지 못한 애매 통화(통화 메뉴 맨 위 "확인할 통화"). 두 값 모두 업무 기록에 쓰이지 않는다.
-- created_at은 통화 줄이 처음 만들어진 시각이라 옮겨도 유지한다. moved_at은 업무 통화함에서 옮겨 온 시각(직접 들어온 줄은 비어 있음).
create table public.app_call_personal (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null default 'personal',
  day date not null,
  occurred_at timestamptz not null,
  title text not null,
  summary text,
  points jsonb not null default '[]'::jsonb,
  counterpart text,
  speaker_split boolean not null default false,
  raw_text text,
  source_ref text not null,
  drive_url text,
  hidden_at timestamptz,
  model text,
  judged_at timestamptz,
  moved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_call_personal_kind_check check (kind in ('personal', 'unsure')),
  constraint app_call_personal_title_check check (char_length(btrim(title)) between 1 and 80 and title !~ '[[:cntrl:]]'),
  constraint app_call_personal_summary_check check (
    summary is null or (char_length(btrim(summary)) between 1 and 400 and summary !~ '[\u0001-\u0009\u000b-\u001f\u007f]')),
  constraint app_call_personal_points_check check (
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) <= 8
    and not jsonb_path_exists(points, 'strict $[*] ? (@.type() != "string")')
    and not jsonb_path_exists(points, '$[*] ? (!(@ like_regex "[^[:space:]]"))')
    and not jsonb_path_exists(points, '$[*] ? (@ like_regex "[\u0001-\u001f\u007f]")')
    and not jsonb_path_exists(points, '$[*] ? (@ like_regex "^.{151}.{150}")')),
  constraint app_call_personal_counterpart_check check (
    counterpart is null or (char_length(btrim(counterpart)) between 1 and 100 and counterpart !~ '[[:cntrl:]]')),
  constraint app_call_personal_raw_text_check check (raw_text is null or octet_length(raw_text) between 1 and 204800),
  constraint app_call_personal_source_ref_check check (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  constraint app_call_personal_drive_url_check check (
    drive_url is null or (char_length(drive_url) <= 500 and drive_url ~ '^https://(drive|docs)\.google\.com/[^[:space:][:cntrl:]]*$')),
  constraint app_call_personal_model_check check (
    model is null or (char_length(model) between 1 and 100 and model !~ '[[:cntrl:]]')),
  -- 같은 원본은 이 표에서 한 번만(반대 표와의 중복은 아래 트리거가 막는다).
  constraint app_call_personal_source_ref_key unique (workspace_id, source_ref)
);
create index app_call_personal_list_idx on public.app_call_personal(workspace_id, kind, day desc, occurred_at desc);

-- 2) 업무 통화함 쪽 표시 칸. 기본값 없음, 기존 줄은 비어 있다. 쓰기 권한은 주지 않는다(함수만 쓴다).
alter table public.app_feed_items
  add column moved_at timestamptz,
  add column refilled_at timestamptz;

-- 3) 트리거 함수. 둘 다 INVOKER·빈 search_path·public 표만 직접 부른다(service_role에는 schema private 사용권이 없다: 20261024210000).
-- 3-가) 원본 고유키 양쪽 중복 방지: 통화 줄을 넣기 전에 반대 표에 같은 (작업공간, 원본 고유키)가 있으면 거절한다.
--   같은 키의 동시 넣기·옮기기는 키별 잠금으로 직렬화한다. 옮기기 함수는 원본을 먼저 지우고 넣으므로 자기 자신과는 부딪치지 않는다.
create function private.app_call_ref_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  -- 두 표가 같은 함수를 쓰므로 new.source는 업무 표일 때만 건드린다(개인 표에는 source 칸이 없다).
  if tg_table_name = 'app_feed_items' then
    if new.source <> 'call' then
      return new;
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_ref:' || new.workspace_id::text || ':' || new.source_ref, 0));
  if tg_table_name = 'app_feed_items' then
    if exists (select 1 from public.app_call_personal p where p.workspace_id = new.workspace_id and p.source_ref = new.source_ref) then
      raise exception using errcode = '23505', message = 'CALL_REF_IN_PERSONAL_BOX: this call already lives in the personal box';
    end if;
  else
    if exists (select 1 from public.app_feed_items f where f.workspace_id = new.workspace_id and f.source = 'call' and f.source_ref = new.source_ref) then
      raise exception using errcode = '23505', message = 'CALL_REF_IN_WORK_BOX: this call already lives in the work box';
    end if;
  end if;
  return new;
end
$guard$;
revoke all on function private.app_call_ref_guard() from public, anon, authenticated, service_role;

-- 3-나) 개인 표의 전문은 비우기만(업무 표와 같은 규칙).
create function private.app_call_personal_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_call_personal_guard() from public, anon, authenticated, service_role;

create trigger app_call_personal_guard
before insert or update on public.app_call_personal
for each row execute function private.app_call_personal_guard();

create trigger app_call_personal_ref_guard
before insert on public.app_call_personal
for each row execute function private.app_call_ref_guard();

create trigger app_feed_items_call_ref_guard
before insert on public.app_feed_items
for each row execute function private.app_call_ref_guard();

-- 4) 권한과 정책: 호스팅 기본 권한을 모두 걷어 낸 뒤 필요한 칸만 준다.
alter table public.app_call_personal enable row level security;
revoke all on table public.app_call_personal from public, anon, authenticated, service_role;

-- authenticated(owner): 읽기, 지우기(hidden_at)·전문 비우기만. 넣기·행 지우기·kind/title 쓰기 없음(kind와 옮기기는 함수만).
grant select on table public.app_call_personal to authenticated;
grant update (hidden_at, raw_text, updated_at) on table public.app_call_personal to authenticated;
-- service_role(collector-feed, 2단계): 개인·애매 통화를 넣기만 + 중복 확인 두 칸 읽기. 고치기·지우기·moved_at 쓰기 없음.
grant select (workspace_id, source_ref) on table public.app_call_personal to service_role;
grant insert (workspace_id, kind, day, occurred_at, title, summary, points, counterpart, speaker_split, raw_text, source_ref, drive_url, model, judged_at)
  on table public.app_call_personal to service_role;

create policy call_personal_owner_all on public.app_call_personal for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 5-가) 한 함에서 다른 함으로 옮기기. 소유자 확인은 함수 안에서 한다("없음"과 "남의 것"은 같은 오류로 답해 존재 여부를 알리지 않는다).
--   work     : 개인·애매 통화 → 업무 통화함(app_feed_items). 연결 없이 들어오고 moved_at을 기록, refilled_at은 비워 "다시 채우기 대기"가 된다.
--   personal : 업무 통화 → 개인 통화함, 또는 애매 통화를 개인으로 정하기(같은 표, kind만 바뀜). 고정·조직·프로젝트 연결은 사라진다.
--   원본을 지우고 반대 표에 같은 id·같은 원본 고유키로 넣는 일이 이 함수 한 번(한 트랜잭션)이라 중간에 어디에도 없거나 양쪽에 있는 순간이 없다.
--   텔레그램 줄은 거절한다. 같은 함으로 옮기면 아무것도 안 한다.
create function public.app_call_move(p_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.app_feed_items%rowtype;
  p public.app_call_personal%rowtype;
begin
  if p_to is null or p_to not in ('work', 'personal') then
    raise exception using errcode = '22023', message = 'CALL_MOVE_TARGET';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_move:' || coalesce(p_id::text, ''), 0));

  select * into w from public.app_feed_items f where f.id = p_id;
  if found then
    if not private.app_is_workspace_owner(w.workspace_id) then
      raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
    end if;
    if w.source <> 'call' then
      raise exception using errcode = '23514', message = 'CALL_NOT_CALL';
    end if;
    if p_to = 'work' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'work', 'changed', false, 'needs_refill', false);
    end if;
    delete from public.app_feed_items f where f.id = w.id and f.workspace_id = w.workspace_id;
    insert into public.app_call_personal (id, workspace_id, kind, day, occurred_at, title, summary, points, counterpart, speaker_split,
      raw_text, source_ref, drive_url, hidden_at, model, judged_at, moved_at, created_at, updated_at)
    values (w.id, w.workspace_id, 'personal', w.day, w.occurred_at, w.title, w.summary, w.points, w.counterpart, w.speaker_split,
      w.raw_text, w.source_ref, w.drive_url, w.hidden_at, w.model, w.judged_at, pg_catalog.now(), w.created_at, pg_catalog.now());
    return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;

  select * into p from public.app_call_personal c where c.id = p_id;
  if not found or not private.app_is_workspace_owner(p.workspace_id) then
    raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
  end if;
  if p_to = 'personal' then
    if p.kind = 'personal' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'personal', 'to', 'personal', 'changed', false, 'needs_refill', false);
    end if;
    update public.app_call_personal c set kind = 'personal', updated_at = pg_catalog.now()
     where c.id = p.id and c.workspace_id = p.workspace_id;
    return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'unsure', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;
  delete from public.app_call_personal c where c.id = p.id and c.workspace_id = p.workspace_id;
  insert into public.app_feed_items (id, workspace_id, source, day, occurred_at, title, summary, points, counterpart, speaker_split,
    raw_text, raw_count, source_ref, drive_url, hidden_at, model, judged_at, moved_at, refilled_at, created_at, updated_at)
  values (p.id, p.workspace_id, 'call', p.day, p.occurred_at, p.title, p.summary, p.points, p.counterpart, p.speaker_split,
    p.raw_text, 0, p.source_ref, p.drive_url, p.hidden_at, p.model, p.judged_at, pg_catalog.now(), null, p.created_at, pg_catalog.now());
  return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', p.kind, 'to', 'work', 'changed', true, 'needs_refill', true);
end
$$;
revoke all on function public.app_call_move(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_call_move(uuid, text) to authenticated;

-- 5-나) 개인에서 업무로 옮긴 직후 한 번만 업무 기준 정보를 채운다: 옮겨 온 적이 있고(moved_at) 아직 안 채운(refilled_at 비어 있음) 업무 통화에만.
--   조직은 같은 작업공간 것만. 제목은 비우면 그대로, 상대 표기·조직은 비우면 비운 채로 "채움 끝"만 기록한다(AI가 못 찾은 경우). 핵심내용·전문은 건드리지 않는다.
create function public.app_call_work_info(p_id uuid, p_title text, p_counterpart text, p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.app_feed_items%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_move:' || coalesce(p_id::text, ''), 0));
  select * into w from public.app_feed_items f where f.id = p_id;
  if not found or not private.app_is_workspace_owner(w.workspace_id) then
    raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
  end if;
  if w.source <> 'call' or w.moved_at is null or w.refilled_at is not null then
    raise exception using errcode = '23514', message = 'CALL_REFILL_NOT_PENDING';
  end if;
  if p_organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = p_organization_id and o.workspace_id = w.workspace_id) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization must be in the same workspace';
  end if;
  update public.app_feed_items f
     set title = coalesce(nullif(pg_catalog.btrim(p_title), ''), f.title),
         counterpart = nullif(pg_catalog.btrim(p_counterpart), ''),
         organization_id = p_organization_id,
         refilled_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where f.id = w.id
     and f.workspace_id = w.workspace_id;
  return pg_catalog.jsonb_build_object('ok', true, 'id', w.id);
end
$$;
revoke all on function public.app_call_work_info(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_call_work_info(uuid, text, text, uuid) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소. 업무 표 권한·정책·기존 트리거는 그대로, 새 표는 소유자 전용, 새 함수는 authenticated만 실행.
do $$
begin
  if (select count(*) from pg_proc where oid in (to_regprocedure('public.app_call_move(uuid,text)'), to_regprocedure('public.app_call_work_info(uuid,text,text,uuid)'))
         and prosecdef and proconfig = array['search_path=""']
         and has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 2
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_call_ref_guard()'), to_regprocedure('private.app_call_personal_guard()'),
         to_regprocedure('private.app_feed_item_guard()'))
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%private.%'
         and coalesce(proacl::text, '') !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 3
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal
         and tgname in ('app_feed_items_guard', 'app_feed_items_call_ref_guard')) <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.app_call_personal'::regclass and not tgisinternal) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_feed_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_call_personal'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_call_personal'::regclass) <> 1
     or not exists (select 1 from pg_class where oid = 'public.app_call_personal'::regclass and relrowsecurity and not relforcerowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_feed_items'::regclass, 'public.app_call_personal'::regclass)
                and coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_feed_items'::regclass, 'public.app_call_personal'::regclass)
                and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_call_personal', 'insert')
     or has_table_privilege('authenticated', 'public.app_call_personal', 'delete')
     or has_column_privilege('authenticated', 'public.app_call_personal', 'kind', 'update')
     or has_column_privilege('authenticated', 'public.app_call_personal', 'title', 'update')
     or has_column_privilege('authenticated', 'public.app_call_personal', 'moved_at', 'update')
     or has_table_privilege('service_role', 'public.app_call_personal', 'delete')
     or has_any_column_privilege('service_role', 'public.app_call_personal', 'update')
     or has_column_privilege('service_role', 'public.app_call_personal', 'moved_at', 'insert')
     or has_column_privilege('service_role', 'public.app_call_personal', 'raw_text', 'select')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'moved_at', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'refilled_at', 'update')
     or has_column_privilege('service_role', 'public.app_feed_items', 'moved_at', 'insert')
     or has_column_privilege('service_role', 'public.app_feed_items', 'refilled_at', 'insert')
     or has_any_column_privilege('service_role', 'public.app_feed_items', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'source', 'update') then
    raise exception 'CALL_PERSONAL_BOX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025200000', 'call_personal_box', array['CALL-개인통화함 1단계(B안): new table app_call_personal (personal/unsure calls, owner RLS authenticated only, authenticated select + hide/clear-raw update, service_role insert only), app_feed_items.moved_at/refilled_at columns, cross-table source_ref duplicate guard triggers (INVOKER), app_call_move + app_call_work_info (SECURITY DEFINER, empty search_path, owner check, execute to authenticated only), no anon/PUBLIC, no change to existing policies, grants or trigger bodies']);
commit;
