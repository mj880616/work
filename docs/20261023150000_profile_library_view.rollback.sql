begin;
-- 20261023150000_profile_library_view의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 자료실 보기 기억(묶기·종류 칩)이 저장돼 있으면(화면에서 고른 뒤) 멈춘다. 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 값을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸이 없으면 기본 보기로 열리고 기억만 하지 않는다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023150000' and name = 'profile_library_view') <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where library_view is not null) then
    raise exception 'PROFILE_LIBRARY_VIEW_ROLLBACK_BLOCKED: view saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_library_view_check,
  drop column library_view;

delete from supabase_migrations.schema_migrations
  where version = '20261023150000' and name = 'profile_library_view';
commit;
