begin;
-- 20261022150000_profile_quick_links의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 링크 목록을 저장해 두었으면(화면에서 편집한 뒤) 멈춘다. 목록을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 목록을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸이 없으면 초기 링크를 보여 준다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022150000' and name = 'profile_quick_links') <> 1 then
    raise exception 'PROFILE_QUICK_LINKS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where quick_links is not null) then
    raise exception 'PROFILE_QUICK_LINKS_ROLLBACK_BLOCKED: links saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_quick_links_check,
  drop column quick_links;

delete from supabase_migrations.schema_migrations
  where version = '20261022150000' and name = 'profile_quick_links';
commit;
