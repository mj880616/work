begin;
-- S47-12 폰 알림 N2 DB (APP-폰알림, 명진 11/01 01:04 "폰 알림 ㄱ" = 설계 9절 N-D1~N-D7 추천대로). 설계: docs/design/phone-notifications.md 4.1절.
-- 적용은 docs/ops-db-workflow.md "승인 한 번 흐름"(승인형 DB workflow)으로만 한다.
--
--  1) app_push_devices: 이 작업공간 주인 폰의 FCM 기기 토큰(알림 받을 주소). 넣기·고치기는 Edge phone-push(service_role)만.
--     화면(authenticated)은 자기 작업공간 기기의 토큰 밖 칸만 읽고, 기기를 지울 수 있다(토큰 칸은 읽지 못함 — 끝 6자리는 Edge가 보여 줌).
--  2) app_push_log: 보낸·보류한 알림 기록(같은 종류·같은 기록·같은 날 한 번). 알림 제목·본문은 저장하지 않는다(종류·기록 열쇠·날짜·상태만).
--     화면은 읽기만, 쓰기·30일 지난 행 지우기는 Edge만.
--  3) app_profiles.notify_prefs: 종류별 켜기/끄기와 조용한 시간(jsonb + 검사 제약). 비어 있음 = 기본(전부 켬, 22:00~07:00).
--     기존 app_profiles 권한·정책(task12a owner) 그대로 — 화면이 내 프로필 저장처럼 PATCH한다.
--
-- 권한: 새 두 표 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책(authenticated만). anon·PUBLIC 권한 없음.
--   authenticated: devices 토큰 밖 칸 읽기·지우기, log 읽기만. service_role(Edge phone-push): 두 표 select·insert·update·delete 넷만.
-- 안 하는 것: 기존 표 권한·정책·함수 변경, 새 함수, 확장, 읽생기 표. 옛 push-notifications 구조는 되살리지 않는다.
-- 짝: docs/20261101010000_phone_push.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101010000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_profiles') is null
     or to_regclass('public.app_push_devices') is not null
     or to_regclass('public.app_push_log') is not null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'notify_prefs')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_notify_prefs_check')
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음, 정책 두 개.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2 then
    raise exception 'PHONE_PUSH_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_push_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint app_push_devices_token_unique unique (fcm_token),
  constraint app_push_devices_token_check check (char_length(fcm_token) between 20 and 4096 and fcm_token ~ '^[A-Za-z0-9_:-]+$'),
  constraint app_push_devices_version_check check (app_version is null or app_version ~ '^[0-9A-Za-z.+-]{1,40}$')
);
create index app_push_devices_ws_idx on public.app_push_devices(workspace_id) where revoked_at is null;

create table public.app_push_log (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null,
  ref_key text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  status text not null,
  primary key (workspace_id, kind, ref_key, day),
  constraint app_push_log_kind_check check (kind in (
    'task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week', 'quiet_digest', 'test')),
  constraint app_push_log_ref_check check (ref_key ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  constraint app_push_log_status_check check (status in ('sent', 'held_quiet', 'failed', 'skipped_off'))
);
create index app_push_log_sent_idx on public.app_push_log(sent_at);

alter table public.app_push_devices enable row level security;
alter table public.app_push_log enable row level security;
revoke all on table public.app_push_devices from public, anon, authenticated, service_role;
revoke all on table public.app_push_log from public, anon, authenticated, service_role;

-- 화면: 기기 목록은 토큰 칸 없이, 지우기(이 폰 알림 끊기)는 가능.
grant select (id, workspace_id, user_id, app_version, created_at, last_seen_at, revoked_at)
  on table public.app_push_devices to authenticated;
grant delete on table public.app_push_devices to authenticated;
grant select on table public.app_push_log to authenticated;

grant select, insert, update, delete on table public.app_push_devices to service_role;
grant select, insert, update, delete on table public.app_push_log to service_role;

create policy push_devices_owner_all on public.app_push_devices for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy push_log_owner_select on public.app_push_log for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 알림 설정. 비어 있으면(null) 서버·화면이 기본(전부 켬, 조용한 시간 22:00~07:00 서울)을 쓴다.
-- 모양: {"kinds":{종류:true|false, ...},"quiet":{"from":"HH:MM","to":"HH:MM"}} — 두 칸 다 선택, 다른 칸은 거절.
-- 칸마다 CASE로 순서를 고정해(앞 조건이 틀리면 뒤 조건은 보지 않음) 모양이 틀린 값도 오류가 아니라 거절로 끝난다.
alter table public.app_profiles
  add column notify_prefs jsonb;
alter table public.app_profiles
  add constraint app_profiles_notify_prefs_check check (
    case
      when notify_prefs is null then true
      when jsonb_typeof(notify_prefs) <> 'object' then false
      else
        octet_length(notify_prefs::text) <= 1000
        and not jsonb_path_exists(notify_prefs, 'strict $.keyvalue() ? (!(@.key == "kinds" || @.key == "quiet"))')
        and case when not (notify_prefs ? 'kinds') then true
              when jsonb_typeof(notify_prefs -> 'kinds') <> 'object' then false
              else not jsonb_path_exists(notify_prefs, 'strict $.kinds.keyvalue() ? (!(@.key == "task_due" || @.key == "commitment" || @.key == "meeting_done" || @.key == "collect_stall" || @.key == "morning" || @.key == "evening" || @.key == "next_week"))')
               and not jsonb_path_exists(notify_prefs, 'strict $.kinds.* ? (@.type() != "boolean")') end
        and case when not (notify_prefs ? 'quiet') then true
              when jsonb_typeof(notify_prefs -> 'quiet') <> 'object' then false
              else not jsonb_path_exists(notify_prefs, 'strict $.quiet.keyvalue() ? (!(@.key == "from" || @.key == "to"))')
               and coalesce(jsonb_typeof(notify_prefs -> 'quiet' -> 'from'), '') = 'string'
               and coalesce(jsonb_typeof(notify_prefs -> 'quiet' -> 'to'), '') = 'string'
               and (notify_prefs -> 'quiet' ->> 'from') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               and (notify_prefs -> 'quiet' ->> 'to') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' end
    end
  );

-- 사후 확인: 두 표 RLS 켜짐·anon·PUBLIC 권한 없음·authenticated 정해진 권한만(토큰 칸 읽기 없음)·service_role 넷만,
-- 정책은 표마다 1개(authenticated만), app_profiles 권한 경계 그대로·새 칸은 모두 비어 있음. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_push_devices'::regclass, 'public.app_push_log'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'insert,update,references')
       or not has_table_privilege('service_role', t, 'select,insert,update,delete')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or (select count(*) from pg_policy where polrelid = t) <> 1
       or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
      raise exception 'PHONE_PUSH_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.app_push_devices', 'fcm_token', 'select')
     or has_table_privilege('authenticated', 'public.app_push_devices', 'select')
     or not has_column_privilege('authenticated', 'public.app_push_devices', 'last_seen_at', 'select')
     or not has_table_privilege('authenticated', 'public.app_push_devices', 'delete')
     or not has_table_privilege('authenticated', 'public.app_push_log', 'select')
     or has_table_privilege('authenticated', 'public.app_push_log', 'delete')
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where notify_prefs is not null) then
    raise exception 'PHONE_PUSH_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101010000', 'phone_push', array['S47-12 APP-폰알림 N2: app_push_devices (owner RLS, authenticated reads non-token columns and deletes, service_role writes) + app_push_log (owner read, service_role writes) + app_profiles.notify_prefs jsonb CHECK (existing owner RLS)']);
commit;
