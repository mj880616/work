begin;
-- 20261115223000_profile_union_department의 짝 되돌리기. 검사 조건 둘·칸 둘과 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 노조명·부서명을 하나라도 저장했으면(화면 PR이 나간 뒤) 멈춘다. 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면 PR을 되돌리고, 값을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115223000' and name = 'profile_union_department') <> 1 then
    raise exception 'PROFILE_UNION_DEPARTMENT_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where union_name is not null or department_name is not null) then
    raise exception 'PROFILE_UNION_DEPARTMENT_ROLLBACK_BLOCKED: names saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_union_name_check,
  drop constraint app_profiles_department_name_check,
  drop column union_name,
  drop column department_name;

delete from supabase_migrations.schema_migrations
  where version = '20261115223000' and name = 'profile_union_department';
commit;
