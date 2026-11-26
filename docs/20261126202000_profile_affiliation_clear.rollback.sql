begin;
-- 20261126202000_profile_affiliation_clear의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·표 지우기를 막는다).
-- 1) 백업 표(public.app_cleanup_s71_40_profiles)의 옛 값을, 지금도 비어 있는 칸에만 되돌려 넣는다(적용 뒤 사람이 새로 적은 값은 덮지 않는다).
-- 2) 백업 표와 이번 기록 1행을 지운다. 이름·다른 칸·표·권한·정책·함수·트리거는 건드리지 않는다.
-- 화면이 그 칸을 다시 보여 주는 판일 때만 의미가 있다(S71-34 뒤에는 칸이 화면에 없다).
-- 실행 전 확인: 첫 줄 begin; · 마지막 줄 commit; · 대상 프로젝트. 실행 뒤 짝 precheck의 'backup table absent'·'new migration absent'가 예인지 본다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126202000' and name = 'profile_affiliation_clear') <> 1
     or to_regclass('public.app_cleanup_s71_40_profiles') is null then
    raise exception 'PROFILE_AFFILIATION_CLEAR_ROLLBACK_BLOCKED: migration record or backup table differs';
  end if;
end
$$;

update public.app_profiles p
   set union_name = coalesce(p.union_name, b.union_name),
       department_name = coalesce(p.department_name, b.department_name),
       job_title = coalesce(p.job_title, b.job_title)
  from public.app_cleanup_s71_40_profiles b
 where p.user_id = b.user_id;

drop table public.app_cleanup_s71_40_profiles;

delete from supabase_migrations.schema_migrations
  where version = '20261126202000' and name = 'profile_affiliation_clear';
commit;
