begin;
-- 20261124160000_library_org_folder의 짝 되돌리기. 함수 1개와 두 칸(색인·외래 키 포함)을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(확장 규칙 migration). 화면은 칸이 없으면 읽기가 400 → 기능 꺼짐(지금처럼)으로 동작하므로 화면을 먼저 되돌리지 않아도 된다.
-- 모으는 폴더 설정과 조직 ↔ 폴더 짝만 사라진다. 자료실 폴더·자료·폴더 안 자료 연결과 드라이브 파일은 그대로다.
--   개수 확인: select count(*) from public.app_library_folders where organization_id is not null;
--             select count(*) from public.app_profiles where org_files_folder is not null;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261124160000' and name = 'library_org_folder') <> 1 then
    raise exception 'LIBRARY_ORG_FOLDER_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_library_folder_set_org(uuid, uuid);

drop index public.app_library_folders_org_idx;
alter table public.app_library_folders drop constraint app_library_folders_organization_fkey;
alter table public.app_library_folders drop column organization_id;

drop index public.app_profiles_org_files_folder_idx;
alter table public.app_profiles drop constraint app_profiles_org_files_folder_fkey;
alter table public.app_profiles drop column org_files_folder;

delete from supabase_migrations.schema_migrations
  where version = '20261124160000' and name = 'library_org_folder';
commit;
