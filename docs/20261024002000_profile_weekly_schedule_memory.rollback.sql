begin;
-- 20261024002000_profile_weekly_schedule_memory의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 기억이 한 항목이라도 저장돼 있으면(화면에서 [기억하기]를 누른 뒤) 멈춘다. 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 값을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸이 없으면 기억 없이 달력 제목 그대로 초안을 만든다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024002000' and name = 'profile_weekly_schedule_memory') <> 1 then
    raise exception 'PROFILE_WEEKLY_SCHEDULE_MEMORY_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where weekly_schedule_memory <> '[]'::jsonb) then
    raise exception 'PROFILE_WEEKLY_SCHEDULE_MEMORY_ROLLBACK_BLOCKED: memory saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_weekly_schedule_memory_check,
  drop column weekly_schedule_memory;

delete from supabase_migrations.schema_migrations
  where version = '20261024002000' and name = 'profile_weekly_schedule_memory';
commit;
