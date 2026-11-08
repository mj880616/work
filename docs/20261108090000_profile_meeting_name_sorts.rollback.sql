begin;
-- 20261108090000_profile_meeting_name_sorts의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 회의명 정리(상위 목록·비정기·목록에서 지움)가 하나라도 저장돼 있으면(화면 ⋯에서 바꾼 뒤) 멈춘다. 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 값을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸을 못 읽으면 모든 회의명을 정기처럼 펼쳐 보인다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261108090000' and name = 'profile_meeting_name_sorts') <> 1 then
    raise exception 'PROFILE_MEETING_NAME_SORTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where meeting_name_sorts <> '{}'::jsonb) then
    raise exception 'PROFILE_MEETING_NAME_SORTS_ROLLBACK_BLOCKED: sorts saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_meeting_name_sorts_check,
  drop column meeting_name_sorts;

delete from supabase_migrations.schema_migrations
  where version = '20261108090000' and name = 'profile_meeting_name_sorts';
commit;
