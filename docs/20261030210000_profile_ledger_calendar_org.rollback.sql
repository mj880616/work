begin;
-- 20261030210000_profile_ledger_calendar_org의 짝 되돌리기. 참고 캘린더 검사를 org 없이 세 키(calendar·colors·mine)만 받는
-- 20261025110000 ledger_sources 모양으로 되돌리고 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 org가 저장돼 있으면 멈춘다. 값을 지우거나 바꿔서 통과시키지 않는다
-- (먼저 화면 PR(2/2)을 이전 판으로 되돌리고, 남은 값을 어떻게 할지 명진이 정한 뒤 다시 계획한다. 조직 추천 줄이 안 보일 뿐이라 급하지 않다).
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261030210000' and name = 'profile_ledger_calendar_org') <> 1 then
    raise exception 'PROFILE_LEDGER_CALENDAR_ORG_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where ledger_calendar ? 'org') then
    raise exception 'PROFILE_LEDGER_CALENDAR_ORG_ROLLBACK_BLOCKED: organization saved; decide it first';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_ledger_calendar_check;
alter table public.app_profiles
  add constraint app_profiles_ledger_calendar_check check (
    case
      when jsonb_typeof(ledger_calendar) <> 'object' then false
      else
        octet_length(ledger_calendar::text) <= 2048
        and not jsonb_path_exists(ledger_calendar, 'strict $.keyvalue() ? (!(@.key == "calendar" || @.key == "colors" || @.key == "mine"))')
        and case when not (ledger_calendar ? 'calendar') then true
              when jsonb_typeof(ledger_calendar -> 'calendar') <> 'string' then false
              else char_length(ledger_calendar ->> 'calendar') between 1 and 200 and (ledger_calendar ->> 'calendar') !~ '[[:cntrl:]]' end
        and case when not (ledger_calendar ? 'colors') then true
              when jsonb_typeof(ledger_calendar -> 'colors') <> 'array' then false
              else jsonb_array_length(ledger_calendar -> 'colors') <= 5
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (@.type() != "string")')
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (!(@ like_regex "^[0-9]{1,2}$"))') end
        and case when not (ledger_calendar ? 'mine') then true
              else jsonb_typeof(ledger_calendar -> 'mine') = 'boolean' end
    end
  );

delete from supabase_migrations.schema_migrations where version = '20261030210000' and name = 'profile_ledger_calendar_org';
commit;
