begin;
-- TG-개인대화 1단계 DB (docs/design/tg-personal.md 3절). 새 표 1개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- app_tg_personal_days: 개인 텔레그램 방의 "방·하루 한 줄" AI 요약(한 줄 요약 / 기억할 것 / 챙길 것).
--   원문 칸이 없다(원문은 Drive에만 있다). 업무 소식 표(app_feed_items)와 분리해 원장 자동 기록·주간보고·업무일지·바구니 AI·전체 검색이
--   읽는 길에 구조적으로 들어가지 않게 한다. 다른 표를 가리키는 칸·트리거·private 함수 호출이 없다.
-- 쓰는 쪽은 둘이다.
--   1) 서버 함수 collector-feed(뒤 PR, service role, 사용자 로그인 없음): 칸별 넣기 + 중복 확인용 네 칸 읽기. 고치기·지우기·고정·숨기기 없음.
--   2) 로그인한 명진(authenticated, owner만 — private.app_is_workspace_owner): 읽기, 고정·지우기(pinned_at·hidden_at)만 고치기. 넣기·행 지우기 없음.
-- anon·PUBLIC 권한과 공개 정책은 없다. 정책은 authenticated 하나. service_role은 RLS를 우회하므로 정책 대신 칸별 grant로 좁힌다.
-- AI 사용량은 이 표에 두지 않는다(기존 app_feed_days source='telegram'의 ai_* 줄에 서버가 더한다. 한 달 상한을 함께 센다).
-- 적용: 승인형 DB workflow(확장 규칙 — 새 표·authenticated 정책·authenticated/service_role 칸 grant) 또는 SQL Editor(폰 경로 C).
-- 되돌리기(표 삭제)는 SQL Editor 전용.
-- 짝: docs/20261025030000_tg_personal_days.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025030000')
     or to_regclass('public.app_tg_personal_days') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TG_PERSONAL_DAYS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 방·하루 한 줄. 화면에 그릴 때 room_label·one_line·remember·todo는 글자로만 넣는다(바깥 대화에서 온 글).
-- remember·todo: 문자열 배열, 10개 이하, 항목마다 150자 이하(정규식 반복 한도 때문에 `^.{151}`로 검사).
create table public.app_tg_personal_days (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  room_key text not null,
  room_label text not null,
  one_line text not null,
  remember jsonb not null default '[]'::jsonb,
  todo jsonb not null default '[]'::jsonb,
  message_count integer not null default 0,
  source_ref text not null,
  drive_url text,
  model text,
  judged_at timestamptz,
  pinned_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_tg_personal_days_room_key_check check (room_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint app_tg_personal_days_room_label_check check (
    char_length(btrim(room_label)) between 1 and 100 and room_label !~ '[[:cntrl:]]'),
  constraint app_tg_personal_days_one_line_check check (
    char_length(btrim(one_line)) between 1 and 200 and one_line !~ '[\u0001-\u0009\u000b-\u001f\u007f]'),
  constraint app_tg_personal_days_remember_check check (
    jsonb_typeof(remember) = 'array'
    and jsonb_array_length(remember) <= 10
    and not jsonb_path_exists(remember, 'strict $[*] ? (@.type() != "string")')
    and not jsonb_path_exists(remember, '$[*] ? (!(@ like_regex "[^[:space:]]"))')
    and not jsonb_path_exists(remember, '$[*] ? (@ like_regex "[\u0001-\u001f\u007f]")')
    and not jsonb_path_exists(remember, '$[*] ? (@ like_regex "^.{151}")')),
  constraint app_tg_personal_days_todo_check check (
    jsonb_typeof(todo) = 'array'
    and jsonb_array_length(todo) <= 10
    and not jsonb_path_exists(todo, 'strict $[*] ? (@.type() != "string")')
    and not jsonb_path_exists(todo, '$[*] ? (!(@ like_regex "[^[:space:]]"))')
    and not jsonb_path_exists(todo, '$[*] ? (@ like_regex "[\u0001-\u001f\u007f]")')
    and not jsonb_path_exists(todo, '$[*] ? (@ like_regex "^.{151}")')),
  constraint app_tg_personal_days_message_count_check check (message_count between 0 and 5000),
  constraint app_tg_personal_days_source_ref_check check (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  constraint app_tg_personal_days_drive_url_check check (
    drive_url is null or (char_length(drive_url) <= 500 and drive_url ~ '^https://(drive|docs)\.google\.com/[^[:space:][:cntrl:]]*$')),
  constraint app_tg_personal_days_model_check check (
    model is null or (char_length(model) between 1 and 100 and model !~ '[[:cntrl:]]')),
  -- 같은 방·날은 한 번만 요약한다("요약은 한 번만"을 DB가 보장, AI 재호출 비용 방지).
  constraint app_tg_personal_days_source_ref_key unique (workspace_id, source_ref),
  constraint app_tg_personal_days_room_day_key unique (workspace_id, room_key, day)
);
create index app_tg_personal_days_list_idx on public.app_tg_personal_days(workspace_id, day desc, room_key);
create index app_tg_personal_days_pinned_idx on public.app_tg_personal_days(workspace_id, pinned_at desc) where pinned_at is not null;

-- 권한: 호스팅 기본 권한을 모두 걷어 낸 뒤 필요한 칸만 준다.
alter table public.app_tg_personal_days enable row level security;
revoke all on table public.app_tg_personal_days from public, anon, authenticated, service_role;

-- authenticated(owner): 읽기, 고정·지우기만 고치기. 넣기·행 지우기 없음.
grant select on table public.app_tg_personal_days to authenticated;
grant update (pinned_at, hidden_at, updated_at) on table public.app_tg_personal_days to authenticated;

-- service_role(collector-feed): 넣기만 + 중복 확인 네 칸 읽기. 고치기·지우기·고정·숨기기·원문(없음) 없음.
grant select (workspace_id, room_key, day, source_ref) on table public.app_tg_personal_days to service_role;
grant insert (workspace_id, day, room_key, room_label, one_line, remember, todo, message_count, source_ref, drive_url, model, judged_at)
  on table public.app_tg_personal_days to service_role;

create policy tg_personal_days_owner_all on public.app_tg_personal_days for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC 권한 없음, authenticated 넣기·지우기 없음,
-- service_role 고치기·지우기·고정·숨기기 없음, 트리거 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_tg_personal_days'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_tg_personal_days'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_tg_personal_days'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_tg_personal_days', 'insert')
     or has_table_privilege('authenticated', 'public.app_tg_personal_days', 'delete')
     or has_column_privilege('authenticated', 'public.app_tg_personal_days', 'one_line', 'update')
     or has_column_privilege('authenticated', 'public.app_tg_personal_days', 'workspace_id', 'update')
     or has_any_column_privilege('service_role', 'public.app_tg_personal_days', 'update')
     or has_table_privilege('service_role', 'public.app_tg_personal_days', 'delete')
     or has_column_privilege('service_role', 'public.app_tg_personal_days', 'one_line', 'select')
     or has_column_privilege('service_role', 'public.app_tg_personal_days', 'remember', 'select')
     or has_column_privilege('service_role', 'public.app_tg_personal_days', 'pinned_at', 'insert')
     or has_column_privilege('service_role', 'public.app_tg_personal_days', 'hidden_at', 'insert')
     or (select count(*) from pg_policy where polrelid = 'public.app_tg_personal_days'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_tg_personal_days'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_tg_personal_days'::regclass and not tgisinternal) <> 0 then
    raise exception 'TG_PERSONAL_DAYS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025030000', 'tg_personal_days', array['TG-개인대화 1단계: app_tg_personal_days (개인 방 방·하루 AI 요약, 원문 칸 없음), owner RLS (authenticated only), authenticated column update (pin/hide), service_role column insert, no trigger, no anon/PUBLIC']);
commit;
