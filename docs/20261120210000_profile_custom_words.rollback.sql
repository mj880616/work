begin;
-- 20261120210000_profile_custom_words의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 고친 이름을 저장해 두었으면(화면에서 저장했거나 docs/ops/custom-words-operator.apply.sql을 실행한 뒤) 멈춘다.
-- 이름을 지워서 통과시키지 않는다. 그런 경우 먼저 값을 캡처해 보관하고(운영자 값은 docs/ops/custom-words-operator.rollback.sql로 먼저 비움) 다시 계획한다.
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261120210000' and name = 'profile_custom_words') <> 1 then
    raise exception 'PROFILE_CUSTOM_WORDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where custom_words is not null) then
    raise exception 'PROFILE_CUSTOM_WORDS_ROLLBACK_BLOCKED: names saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_custom_words_check,
  drop column custom_words;

delete from supabase_migrations.schema_migrations
  where version = '20261120210000' and name = 'profile_custom_words';
commit;
