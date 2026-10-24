begin;
-- CALL-통화메뉴·TG-소식메뉴 1단계 DB (docs/design/call-telegram-feed.md 4.2·4.3·9절 1번, 12절 결정).
-- 새 표 2개와 트리거 함수 1개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- app_feed_items: 통화 한 건 또는 텔레그램 소식 한 묶음이 한 줄. 업무로 판정된 것만 들어온다(개인·애매는 개수만).
-- app_feed_days: 하루·출처마다 한 줄(머리줄 숫자, 걸러진 수, 텔레그램 AI 사용량). 내용 없음.
-- 쓰는 쪽은 둘이다.
--   1) 서버 함수 collector-feed(다음 PR, service role, 사용자 로그인 없음 — 앱 스크립트가 전용 비밀값으로 부름):
--      app_feed_items는 넣기만(고정·지우기·확정 프로젝트 칸은 못 넣음) + 중복 확인용 세 칸 읽기,
--      app_feed_days는 읽기·넣기·숫자 칸 고치기. 지우기 없음. workspace_id는 서버가 kptu-work로 정한다.
--   2) 로그인한 명진(authenticated, owner만 — private.app_is_workspace_owner): 두 표 읽기,
--      app_feed_items의 고정·지우기(pinned_at·hidden_at)·전문 지우기(raw_text를 비우기만)·조직·프로젝트 확정만 고치기.
--      넣기·행 지우기 없음.
-- anon·PUBLIC 권한과 공개 정책은 없다. 정책은 표마다 authenticated 하나. service_role은 RLS를 우회하는 Supabase 역할이라
-- 정책 대신 칸별 grant로 좁히고, 트리거가 전문 비우기만 허용·연결 대상 같은 작업공간 검사를 모든 역할에 똑같이 건다.
-- 적용: 승인형 DB workflow(확장 규칙 — 새 표·authenticated 정책·authenticated/service_role 칸 grant·INVOKER 트리거 함수)
-- 또는 SQL Editor(폰 경로 C). 되돌리기(표 삭제)는 SQL Editor 전용.
-- 짝: docs/20261024140000_call_tg_feed.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024140000')
     or to_regclass('public.app_feed_items') is not null
     or to_regclass('public.app_feed_days') is not null
     or to_regprocedure('private.app_feed_item_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef) then
    raise exception 'CALL_TG_FEED_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 소식·통화 한 줄. 화면에 그릴 때 room_label·title·summary·points·counterpart·raw_text는 글자로만 넣는다(바깥에서 온 글).
-- counterpart: 통화 상대 표기(분석의 '상대 이름·직책' 절). 담당조직 이름과 확실히 맞으면 '소속조직 이름 직책' 모양.
-- speaker_split: raw_text가 화자별 줄(`나:`/`<상대 표기>:`, 모르면 `상대:`, 헷갈리면 `화자1:`/`화자2:`)이면 true.
-- organization_id: 통화는 상대 글과 담당조직 이름 대조, 텔레그램은 서버 AI 추천(바로 표시, 명진이 바꿀 수 있음).
-- suggested_project_id: 서버 AI 추천만(서버가 씀). project_id: 명진이 상세에서 확정한 것만(화면이 씀).
create table public.app_feed_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  day date not null,
  occurred_at timestamptz not null,
  room_key text,
  room_label text,
  title text,
  summary text,
  points jsonb not null default '[]'::jsonb,
  counterpart text,
  speaker_split boolean not null default false,
  raw_text text,
  raw_count integer not null default 0,
  organization_id uuid references public.app_suborganizations(id) on delete set null,
  suggested_project_id uuid references public.app_spaces(id) on delete set null,
  project_id uuid references public.app_spaces(id) on delete set null,
  source_ref text not null,
  drive_url text,
  pinned_at timestamptz,
  hidden_at timestamptz,
  model text,
  judged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_feed_items_source_check check (source in ('call', 'telegram')),
  -- 통화: 방 없음, 제목 필수, 원문 개수 0. 텔레그램: 방 필수, 상대·화자 구분 없음.
  constraint app_feed_items_shape_check check (
    (source = 'call' and room_key is null and room_label is null and title is not null and raw_count = 0)
    or (source = 'telegram' and room_key is not null and room_label is not null and counterpart is null and not speaker_split)),
  constraint app_feed_items_room_key_check check (room_key is null or room_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint app_feed_items_room_label_check check (
    room_label is null or (char_length(btrim(room_label)) between 1 and 100 and room_label !~ '[[:cntrl:]]')),
  constraint app_feed_items_title_check check (
    title is null or (char_length(btrim(title)) between 1 and 80 and title !~ '[[:cntrl:]]')),
  constraint app_feed_items_summary_check check (
    summary is null or (char_length(btrim(summary)) between 1 and 400 and summary !~ '[\u0001-\u0009\u000b-\u001f\u007f]')),
  constraint app_feed_items_points_check check (
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) <= 8
    and not jsonb_path_exists(points, 'strict $[*] ? (@.type() != "string")')
    and not jsonb_path_exists(points, '$[*] ? (!(@ like_regex "[^[:space:]]"))')
    and not jsonb_path_exists(points, '$[*] ? (@ like_regex "[\u0001-\u001f\u007f]")')
    and not jsonb_path_exists(points, '$[*] ? (@ like_regex "^.{301}")')),
  constraint app_feed_items_counterpart_check check (
    counterpart is null or (char_length(btrim(counterpart)) between 1 and 100 and counterpart !~ '[[:cntrl:]]')),
  constraint app_feed_items_raw_text_check check (raw_text is null or octet_length(raw_text) between 1 and 204800),
  constraint app_feed_items_raw_count_check check (raw_count between 0 and 5000),
  constraint app_feed_items_source_ref_check check (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  constraint app_feed_items_drive_url_check check (
    drive_url is null or (char_length(drive_url) <= 500 and drive_url ~ '^https://(drive|docs)\.google\.com/[^[:space:][:cntrl:]]*$')),
  constraint app_feed_items_model_check check (
    model is null or (char_length(model) between 1 and 100 and model !~ '[[:cntrl:]]')),
  -- 같은 원본은 한 번만 저장한다("요약은 한 번만"을 DB가 보장).
  constraint app_feed_items_source_ref_key unique (workspace_id, source, source_ref)
);
create index app_feed_items_list_idx on public.app_feed_items(workspace_id, source, day desc, occurred_at desc);
create index app_feed_items_pinned_idx on public.app_feed_items(workspace_id, source, pinned_at desc) where pinned_at is not null;

-- 하루·출처마다 한 줄. 숫자만(내용·이름·시각 없음).
-- total_count: 텔레그램은 받은 메시지 수, 통화는 전사본 수. kept_count: 저장한 줄 수. room_count: 텔레그램 방 수.
-- personal_count·unsure_count·failed_count: 걸러진 수. batch_count: 서버가 받은 요청 수(하루 상한 검사용).
-- ai_*: 텔레그램 판정에 쓴 AI 호출·토큰(이 기능 한 달 6,000원 상한 계산용, 기존 app_ai_daily_usage 권한은 건드리지 않음).
create table public.app_feed_days (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  source text not null,
  total_count integer not null default 0,
  kept_count integer not null default 0,
  room_count integer not null default 0,
  personal_count integer not null default 0,
  unsure_count integer not null default 0,
  failed_count integer not null default 0,
  batch_count integer not null default 0,
  ai_requests integer not null default 0,
  ai_input_tokens bigint not null default 0,
  ai_output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, day, source),
  constraint app_feed_days_source_check check (source in ('call', 'telegram')),
  constraint app_feed_days_counts_check check (
    total_count between 0 and 1000000 and kept_count between 0 and 1000000 and room_count between 0 and 10000
    and personal_count between 0 and 1000000 and unsure_count between 0 and 1000000 and failed_count between 0 and 1000000
    and batch_count between 0 and 100000 and ai_requests between 0 and 100000
    and ai_input_tokens between 0 and 1000000000 and ai_output_tokens between 0 and 1000000000)
);

-- 모든 역할 공통 검사(INVOKER, 실행권 전부 회수): 전문은 비우기만, 연결한 조직·프로젝트는 같은 작업공간만.
create function private.app_feed_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  if not private.app_space_in_workspace(new.project_id, new.workspace_id)
     or not private.app_space_in_workspace(new.suggested_project_id, new.workspace_id)
     or (new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = new.organization_id and o.workspace_id = new.workspace_id)) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization or project must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_item_guard() from public, anon, authenticated, service_role;

create trigger app_feed_items_guard
before insert or update on public.app_feed_items
for each row execute function private.app_feed_item_guard();

-- 권한: 호스팅 기본 권한을 모두 걷어 낸 뒤 필요한 칸만 준다.
alter table public.app_feed_items enable row level security;
alter table public.app_feed_days enable row level security;
revoke all on table public.app_feed_items, public.app_feed_days from public, anon, authenticated, service_role;

-- authenticated(owner): 읽기, 고정·지우기·전문 비우기·조직/프로젝트 확정만 고치기. 넣기·지우기 없음.
grant select on table public.app_feed_items to authenticated;
grant update (pinned_at, hidden_at, raw_text, organization_id, project_id, updated_at)
  on table public.app_feed_items to authenticated;
grant select on table public.app_feed_days to authenticated;

-- service_role(collector-feed): 소식·통화는 넣기만 + 중복 확인 세 칸 읽기. 고정·지우기·확정 프로젝트는 못 넣고 못 고친다.
grant select (workspace_id, source, source_ref) on table public.app_feed_items to service_role;
grant insert (workspace_id, source, day, occurred_at, room_key, room_label, title, summary, points, counterpart,
  speaker_split, raw_text, raw_count, organization_id, suggested_project_id, source_ref, drive_url, model, judged_at)
  on table public.app_feed_items to service_role;
-- 하루 숫자는 읽기·넣기·숫자 칸 고치기(같은 날 더하기). 지우기 없음.
grant select on table public.app_feed_days to service_role;
grant insert (workspace_id, day, source, total_count, kept_count, room_count, personal_count, unsure_count, failed_count,
  batch_count, ai_requests, ai_input_tokens, ai_output_tokens, updated_at)
  on table public.app_feed_days to service_role;
grant update (total_count, kept_count, room_count, personal_count, unsure_count, failed_count,
  batch_count, ai_requests, ai_input_tokens, ai_output_tokens, updated_at)
  on table public.app_feed_days to service_role;

create policy feed_items_owner_all on public.app_feed_items for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

create policy feed_days_owner_all on public.app_feed_days for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC 권한 없음, authenticated 넣기·지우기 없음,
-- service_role은 소식 표 고치기·지우기·원문 읽기 없음, 트리거 1개. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_feed_items'::regclass, 'public.app_feed_days'::regclass)
             and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_feed_items'::regclass, 'public.app_feed_days'::regclass)
             and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_feed_items'::regclass, 'public.app_feed_days'::regclass)
             and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_feed_items', 'insert')
     or has_table_privilege('authenticated', 'public.app_feed_items', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_feed_days', 'insert,update')
     or has_table_privilege('authenticated', 'public.app_feed_days', 'delete')
     or has_any_column_privilege('service_role', 'public.app_feed_items', 'update')
     or has_table_privilege('service_role', 'public.app_feed_items', 'delete')
     or has_column_privilege('service_role', 'public.app_feed_items', 'raw_text', 'select')
     or has_column_privilege('service_role', 'public.app_feed_items', 'pinned_at', 'insert')
     or has_column_privilege('service_role', 'public.app_feed_items', 'project_id', 'insert')
     or has_table_privilege('service_role', 'public.app_feed_days', 'delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_feed_items'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_feed_days'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_feed_items'::regclass, 'public.app_feed_days'::regclass)) <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal) <> 1 then
    raise exception 'CALL_TG_FEED_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024140000', 'call_tg_feed', array['CALL-통화메뉴·TG-소식메뉴 1단계: app_feed_items + app_feed_days, owner RLS (authenticated only), authenticated column update (pin/hide/clear raw/link), service_role column insert (+ feed_days counter update), INVOKER guard trigger, no anon/PUBLIC']);
commit;
