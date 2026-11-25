begin;
-- S69-97 NOTE-알림 DB: 노트에 건 알림(정한 시각이 되면 폰 알림)을 폰 알림 서버(phone-push)가 보낼 수 있게 폰 알림 종류 'note' 하나를 더한다.
-- 무엇:
--   1) public.app_push_log의 종류 검사(app_push_log_kind_check)를 지우고 같은 이름으로 다시 만든다: 앞 판(20261115234500_signup_notify) 종류 그대로 + 'note'.
--   2) public.app_profiles의 알림 설정 검사(app_profiles_notify_prefs_check)를 지우고 같은 이름으로 다시 만든다: kinds 키에 'note'만 더함
--      (내 프로필 폰 알림 칩에서 '노트 알림'을 끌 수 있게. 모양·크기 상한·조용한 시간 규칙 그대로).
-- 안 하는 것: 표·칸·권한·정책·RLS·함수·트리거 변경, 기존 줄 변경, anon·PUBLIC 권한, rtw_* 객체. 알림 기록에는 지금처럼 노트 제목·본문을 저장하지 않는다.
-- 짝: docs/20261125130000_note_alarm_push_kind.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_push_log in access exclusive mode;
lock table public.app_profiles in access exclusive mode;

-- 사전 조건: 앞 판(signup_notify) 기록 1행, 두 검사가 signup은 있고 note는 없는 모양. 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125130000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115234500' and name = 'signup_notify') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_kind_check'
         and contype = 'c' and convalidated and pg_get_constraintdef(oid) ~ '''signup''' and pg_get_constraintdef(oid) !~ '''note''') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_notify_prefs_check'
         and contype = 'c' and convalidated and pg_get_constraintdef(oid) ~ '"signup"' and pg_get_constraintdef(oid) !~ '"note"') <> 1 then
    raise exception 'NOTE_ALARM_PUSH_KIND_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_push_log drop constraint app_push_log_kind_check;
alter table public.app_push_log add constraint app_push_log_kind_check check (kind in (
    'task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week', 'quiet_digest', 'test', 'family', 'signup', 'note'));

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
              else not jsonb_path_exists(notify_prefs, 'strict $.kinds.keyvalue() ? (!(@.key == "task_due" || @.key == "commitment" || @.key == "meeting_done" || @.key == "collect_stall" || @.key == "morning" || @.key == "evening" || @.key == "next_week" || @.key == "family" || @.key == "signup" || @.key == "note"))')
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

-- 마지막 확인: 검사 둘이 새 모양으로 하나씩, 정책 수·RLS·anon 권한 그대로. 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_kind_check'
        and convalidated and pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''signup''' and pg_get_constraintdef(oid) ~ '''family''') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_notify_prefs_check'
        and convalidated and pg_get_constraintdef(oid) ~ '"note"' and pg_get_constraintdef(oid) ~ '"signup"' and pg_get_constraintdef(oid) ~ '"family"') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_push_log'::regclass) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_push_log'::regclass and (not relrowsecurity or coalesce(relacl::text, '') ~ '(^|[{,])(anon)?='))
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and (not relrowsecurity or coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')) then
    raise exception 'NOTE_ALARM_PUSH_KIND_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125130000', 'note_alarm_push_kind', array['S69-97 NOTE alarm: app_push_log_kind_check and app_profiles_notify_prefs_check recreated with the extra kind note (no table, column, grant, policy, function or row change)']);
commit;
