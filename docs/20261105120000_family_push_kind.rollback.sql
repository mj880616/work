begin;
-- 20261105120000_family_push_kind의 짝 되돌리기. 검사 둘을 원래 모양(family 없음)으로 다시 만들고 기록 1행을 지운다. SQL Editor 경로 전용.
-- 'family' 알림 기록 줄이나 설정의 family 키가 있으면 멈춘다(지우면 그 기록·설정이 사라지므로). 그때는 먼저 잊지 말기 알림(Edge phone-push)을 되돌리고,
-- 아래 확인 SQL로 개수를 본 뒤 명진이 정한다.
--   select count(*) from public.app_push_log where kind = 'family';  select count(*) from public.app_profiles where notify_prefs -> 'kinds' ? 'family';
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_push_log in access exclusive mode;
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261105120000' and name = 'family_push_kind') <> 1 then
    raise exception 'FAMILY_PUSH_KIND_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_push_log where kind = 'family')
     or exists (select 1 from public.app_profiles where notify_prefs -> 'kinds' ? 'family') then
    raise exception 'FAMILY_PUSH_KIND_ROLLBACK_BLOCKED: family rows exist';
  end if;
end
$$;

alter table public.app_push_log drop constraint app_push_log_kind_check;
alter table public.app_push_log add constraint app_push_log_kind_check check (kind in (
    'task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week', 'quiet_digest', 'test'));

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

delete from supabase_migrations.schema_migrations
  where version = '20261105120000' and name = 'family_push_kind';
commit;
