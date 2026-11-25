begin;
-- 20261125193000_profile_weekly_team_folder의 짝 되돌리기. 칸 하나(색인·외래 키 포함)를 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(확장 규칙 migration). 화면은 이 칸이 없으면 읽기가 400 → 개인 칸 하나만 쓰는 S69-67 동작(지금처럼)으로 동작하므로 화면을 먼저 되돌리지 않아도 된다.
-- 팀 보고 취합 저장 폴더 설정만 사라진다(내 주간 보고 저장 폴더 weekly_folder는 그대로). 자료실 폴더·자료·폴더 안 자료 연결과 드라이브 파일은 그대로다.
--   개수 확인: select count(*) from public.app_profiles where weekly_team_folder is not null;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261125193000' and name = 'profile_weekly_team_folder') <> 1 then
    raise exception 'PROFILE_WEEKLY_TEAM_FOLDER_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop index public.app_profiles_weekly_team_folder_idx;
alter table public.app_profiles drop constraint app_profiles_weekly_team_folder_fkey;
alter table public.app_profiles drop column weekly_team_folder;

delete from supabase_migrations.schema_migrations
  where version = '20261125193000' and name = 'profile_weekly_team_folder';
commit;
