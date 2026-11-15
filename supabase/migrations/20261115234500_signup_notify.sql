begin;
-- S62-25 OPS-새가입알림 PR①(DB, 명진 11/15 21:04 "사람들이 새로 가입하면 명진에게 알려주는 알림 필요").
-- 새로 가입(작업공간 생성)하면 운영자(명진)에게만 폰 알림 '새 가입 n명 — 이름' + 앱 안 알림 줄, 누르면 운영자 전용 '가입자' 목록.
--  1) public.app_push_log 종류 검사(app_push_log_kind_check)를 지우고 같은 이름으로 다시 만든다: 기존 열 종류 + 'signup'.
--  2) public.app_profiles 알림 설정 검사(app_profiles_notify_prefs_check)를 지우고 같은 이름으로 다시 만든다: kinds 키에 'signup'만 더함
--     (내 프로필 폰 알림 칩에서 '새 가입'을 끌 수 있게. 모양·크기 상한·조용한 시간 규칙 그대로).
--  3) private.app_signup_people(): 가입자 한 사람당 한 줄 — 표시 이름(구글 이름 → 프로필 이름 → '이름 없음', 40자)·가입 시각(작업공간 owner 행이
--     처음 생긴 때)·마지막 접속(로그인 시각). 메일·작업공간 id·기록 내용은 돌려주지 않는다. API 역할 실행 권한 없음(아래 두 함수만 부름).
--  4) public.app_signup_list(): 운영자(운영자 기능 'dev_inbox' 작업공간 owner, private.app_workspace_has_feature)만 — 가입자 목록(이름·가입 시각·
--     마지막 접속, 새것부터 500명). 아니면 42501 OPERATOR_FEATURE_REQUIRED. authenticated만 실행.
--  5) public.app_signup_since(p_since): 폰 알림 서버(phone-push 15분 예약, service_role)만 — p_since(초 단위) 뒤 가입한 사람 수·이름 다섯·가장 새 가입 초.
--     service_role만 실행. 받는 사람(운영자 작업공간)은 Edge가 app_operator_feature_workspace('dev_inbox')로 정한다.
-- 안 하는 것: 표·칸·정책·RLS·기존 함수·트리거·운영자 허용 행 변경, 기존 줄 변경, anon·PUBLIC 권한, rtw_* 객체. 알림 기록에는 지금처럼 이름·제목을 저장하지 않는다.
-- 짝: docs/20261115234500_signup_notify.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_push_log in access exclusive mode;
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115234500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261105120000' and name = 'family_push_kind') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103100000' and name = 'dev_inbox_feature') <> 1
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is null
     or to_regprocedure('private.app_signup_people()') is not null
     or to_regprocedure('public.app_signup_list()') is not null
     or to_regprocedure('public.app_signup_since(timestamp with time zone)') is not null
     or (select count(*) from pg_attribute a where not a.attisdropped and (
            (a.attrelid = 'public.app_workspace_members'::regclass and a.attname in ('user_id', 'role', 'created_at'))
         or (a.attrelid = 'public.app_profiles'::regclass and a.attname in ('user_id', 'display_name'))
         or (a.attrelid = 'auth.users'::regclass and a.attname in ('id', 'raw_user_meta_data', 'last_sign_in_at')))) <> 8
     or (select count(*) from pg_constraint where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_kind_check'
         and contype = 'c' and convalidated and pg_get_constraintdef(oid) ~ '''family''' and pg_get_constraintdef(oid) !~ '''signup''') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_notify_prefs_check'
         and contype = 'c' and convalidated and pg_get_constraintdef(oid) ~ 'family' and pg_get_constraintdef(oid) !~ 'signup') <> 1 then
    raise exception 'SIGNUP_NOTIFY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_push_log drop constraint app_push_log_kind_check;
alter table public.app_push_log add constraint app_push_log_kind_check check (kind in (
    'task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week', 'quiet_digest', 'test', 'family', 'signup'));

alter table public.app_profiles drop constraint app_profiles_notify_prefs_check;
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
              else not jsonb_path_exists(notify_prefs, 'strict $.kinds.keyvalue() ? (!(@.key == "task_due" || @.key == "commitment" || @.key == "meeting_done" || @.key == "collect_stall" || @.key == "morning" || @.key == "evening" || @.key == "next_week" || @.key == "family" || @.key == "signup"))')
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

-- 가입자 한 사람당 한 줄. 가입 시각 = 그 사람의 작업공간 owner 행이 처음 생긴 때(app_workspace_start가 만듦). 탈퇴(auth.users 없음)는 빠진다.
create function private.app_signup_people()
returns table (name text, signed_up_at timestamptz, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.left(coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                  nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'name'), ''),
                                  nullif(pg_catalog.btrim(p.display_name), ''), '이름 없음'), 40),
         o.signed_up_at,
         u.last_sign_in_at
    from (select m.user_id, pg_catalog.min(m.created_at) as signed_up_at
            from public.app_workspace_members m
           where m.role = 'owner' and m.user_id is not null and m.created_at is not null
           group by m.user_id) o
    join auth.users u on u.id = o.user_id
    left join public.app_profiles p on p.user_id = o.user_id
$$;

create function public.app_signup_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not exists (select 1 from public.app_operator_features f
                     where f.feature = 'dev_inbox' and private.app_workspace_has_feature(f.workspace_id, 'dev_inbox')) then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', s.name, 'signed_up_at', s.signed_up_at, 'last_seen_at', s.last_seen_at)
             order by s.signed_up_at desc)
      from (select * from private.app_signup_people() x order by x.signed_up_at desc limit 500) s), '[]'::jsonb);
end
$$;

-- 폰 알림 서버 전용. 초 단위로 자른 가입 시각이 p_since보다 뒤인 사람만 센다(같은 가입을 두 번 세지 않게 열쇠도 초 단위).
create function public.app_signup_since(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_since is null then
    raise exception using errcode = '22023', message = 'SIGNUP_SINCE_REQUIRED';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
             'count', pg_catalog.count(*),
             'names', coalesce((select pg_catalog.jsonb_agg(t.name order by t.at desc, t.name)
                                  from (select x.name, pg_catalog.date_trunc('second', x.signed_up_at) as at from private.app_signup_people() x
                                         where pg_catalog.date_trunc('second', x.signed_up_at) > p_since
                                         order by x.signed_up_at desc, x.name limit 5) t), '[]'::jsonb),
             'newest', pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.max(pg_catalog.date_trunc('second', s.signed_up_at))))::bigint)
      from private.app_signup_people() s
     where pg_catalog.date_trunc('second', s.signed_up_at) > p_since);
end
$$;

revoke all on function private.app_signup_people() from public, anon, authenticated, service_role;
revoke all on function public.app_signup_list() from public, anon, authenticated, service_role;
revoke all on function public.app_signup_since(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.app_signup_list() to authenticated;
grant execute on function public.app_signup_since(timestamptz) to service_role;

-- 마지막 확인: 검사 둘이 새 모양으로 하나씩, 정책 수·RLS·anon 권한 그대로, 함수 셋 DEFINER·빈 search_path·정해진 역할만. 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_kind_check'
        and convalidated and pg_get_constraintdef(oid) ~ '''signup''' and pg_get_constraintdef(oid) ~ '''family''') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_notify_prefs_check'
        and convalidated and pg_get_constraintdef(oid) ~ 'signup' and pg_get_constraintdef(oid) ~ 'family') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_push_log'::regclass) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_push_log'::regclass and (not relrowsecurity or coalesce(relacl::text, '') ~ '(^|[{,])(anon)?='))
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and (not relrowsecurity or coalesce(relacl::text, '') ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_signup_people()'), to_regprocedure('public.app_signup_list()'),
           to_regprocedure('public.app_signup_since(timestamp with time zone)')) and prosecdef and proconfig = array['search_path=""']) <> 3
     or has_function_privilege('anon', 'private.app_signup_people()', 'execute')
     or has_function_privilege('authenticated', 'private.app_signup_people()', 'execute')
     or has_function_privilege('service_role', 'private.app_signup_people()', 'execute')
     or has_function_privilege('anon', 'public.app_signup_list()', 'execute')
     or has_function_privilege('service_role', 'public.app_signup_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_signup_list()', 'execute')
     or has_function_privilege('anon', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('authenticated', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or not has_function_privilege('service_role', 'public.app_signup_since(timestamp with time zone)', 'execute') then
    raise exception 'SIGNUP_NOTIFY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115234500', 'signup_notify', array['S62-25 OPS signup notify: app_push_log_kind_check and app_profiles_notify_prefs_check recreated with the extra kind signup; private.app_signup_people() (name, signed-up time, last sign-in; no API execute); operator-only (dev_inbox owner) public.app_signup_list() for authenticated; public.app_signup_since(timestamptz) for service_role only (phone-push cron); no table, column, policy, grant-on-table or row change; no anon or PUBLIC execute']);
commit;
