begin;
-- 20261023180000_profile_view_prefs의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 화면 기억(테마·메뉴·달력 보기 등)이 저장돼 있으면(화면에서 고른 뒤) 멈춘다. 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 값을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸이 없으면 기본 보기로 열리고 기억만 하지 않는다. 기기에서 옮겨 온 값이 여기에만 남아 있을 수 있어 더욱 지우지 않는다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023180000' and name = 'profile_view_prefs') <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where view_prefs is not null) then
    raise exception 'PROFILE_VIEW_PREFS_ROLLBACK_BLOCKED: view saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_view_prefs_check,
  drop column view_prefs;

delete from supabase_migrations.schema_migrations
  where version = '20261023180000' and name = 'profile_view_prefs';
commit;
