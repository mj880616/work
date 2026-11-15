begin;
-- WEEKLY-임원요청정리 (2026-10-23 사용자 요청 12:13·12:15): 주간보고 "1. 요청사항 › 1) 임원 일정 배정·논의 요청" 표의 줄을 Web2에서
-- 넣고·고치고·지우고 서버에 저장한다. 지금까지는 저장할 곳이 없어 직전 주 확정본 표를 그대로 옮겼다.
-- 새 표 1개만 만든다. 기존 표·정책·함수·자료(이미 저장된 지난 보고서 포함)는 바꾸지 않는다.
-- app_weekly_exec_requests: 주(그 주 월요일 = [주간 정리]가 보는 주)마다 1행. items = 요청 줄 목록(jsonb 배열),
--   carried_at = 그 주에 직전 주 확정본에서 줄을 한 번 가져온 시각(한 번 가져온 주는 다시 가져오지 않음 — 지운 줄이 되살아나지 않게).
--   줄 하나 = {id, day, until?, time, what, place, who, carried?}: 날짜(YYYY-MM-DD)·끝 날짜(선택)·시간·내용·장소·참석 요청은 한 줄 글,
--   carried=true는 지난주 확정본에서 가져온 줄(화면의 '지난주에서' 표시만, 한글 파일·복사에는 안 나감).
-- owner만 읽고 쓴다(private.app_is_workspace_owner). 지우기 권한은 주지 않는다(줄을 다 지워도 행은 빈 목록으로 남아 carried_at을 지킴).
-- anon·PUBLIC·service_role 권한과 공개 정책은 없다. 적용: 승인형 DB workflow(확장 규칙 — 새 표·authenticated 정책·grant, 로컬 plan 통과)
-- 또는 SQL Editor(폰 경로 C). 되돌리기(표 삭제)는 SQL Editor 전용.
-- 짝: docs/20261023140000_weekly_exec_requests.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023140000')
     or to_regclass('public.app_weekly_exec_requests') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'WEEKLY_EXEC_REQUESTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 줄 규칙(화면 weekly-exec-requests.js와 같음): 30줄까지, 키는 아래 8개만, id·day·what 필수, 글은 모두 한 줄(제어문자 없음),
-- id 1~40자(영문·숫자·_-), day·until은 YYYY-MM-DD 모양, time 40자·what 200자·place 100자·who 200자까지, what은 빈 글 불가,
-- carried는 true/false. 전체 64KB까지.
create table public.app_weekly_exec_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  items jsonb not null default '[]'::jsonb,
  carried_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_weekly_exec_requests_week_check check (extract(isodow from week_start) = 1),
  constraint app_weekly_exec_requests_items_check check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 30
    and octet_length(items::text) <= 65536
    and not jsonb_path_exists(items, 'strict $[*] ? (@.type() != "object")')
    and not jsonb_path_exists(items, '$[*].keyvalue() ? (!(@.key == "id" || @.key == "day" || @.key == "until" || @.key == "time" || @.key == "what" || @.key == "place" || @.key == "who" || @.key == "carried"))')
    and not jsonb_path_exists(items, '$[*] ? (!exists(@.id) || !exists(@.day) || !exists(@.what))')
    and not jsonb_path_exists(items, '$[*].keyvalue() ? (@.key != "carried" && @.value.type() != "string")')
    and not jsonb_path_exists(items, '$[*].carried ? (@.type() != "boolean")')
    and not jsonb_path_exists(items, '$[*].id ? (!(@ like_regex "^[A-Za-z0-9_-]{1,40}$"))')
    and not jsonb_path_exists(items, '$[*].day ? (!(@ like_regex "^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"))')
    and not jsonb_path_exists(items, '$[*].until ? (!(@ like_regex "^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"))')
    and not jsonb_path_exists(items, '$[*].what ? (!(@ like_regex "[^[:space:]]"))')
    and not jsonb_path_exists(items, '$[*].keyvalue() ? (@.key != "carried" && @.value like_regex "[\u0001-\u001f\u007f]")')
    and not jsonb_path_exists(items, '$[*].time ? (@ like_regex "^.{41}")')
    and not jsonb_path_exists(items, '$[*].what ? (@ like_regex "^.{201}")')
    and not jsonb_path_exists(items, '$[*].place ? (@ like_regex "^.{101}")')
    and not jsonb_path_exists(items, '$[*].who ? (@ like_regex "^.{201}")')),
  constraint app_weekly_exec_requests_one unique (workspace_id, week_start)
);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
-- authenticated: 읽기는 표 전체, 넣기는 필요한 칸만, 고치기는 줄 목록·가져온 시각·고친 시각만(주·작업공간은 못 바꿈). 지우기 없음.
alter table public.app_weekly_exec_requests enable row level security;
revoke all on table public.app_weekly_exec_requests from public, anon, authenticated, service_role;
grant select on table public.app_weekly_exec_requests to authenticated;
grant insert (workspace_id, week_start, items, carried_at, updated_at)
  on table public.app_weekly_exec_requests to authenticated;
grant update (items, carried_at, updated_at) on table public.app_weekly_exec_requests to authenticated;

create policy weekly_exec_requests_owner_all on public.app_weekly_exec_requests for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 지우기 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_weekly_exec_requests'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_weekly_exec_requests', 'delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_exec_requests'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_exec_requests'::regclass) <> 1 then
    raise exception 'WEEKLY_EXEC_REQUESTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023140000', 'weekly_exec_requests', array['WEEKLY-임원요청정리: app_weekly_exec_requests (week x request rows jsonb + carried_at), owner RLS, no delete, no anon/service_role']);
commit;
