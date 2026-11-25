begin;
-- S70-11 WEEKLY-저장폴더나누기(명진 11/25 09:44 "주간보고 안에 … 주간보고, 팀 보고 취합 폴더 만들어놨어 관련 기능에서 파일 만들 때 알아서 저기 안에 넣어요").
-- 주간보고 저장 폴더를 자료 종류별 둘로 나눈다: 내 주간 보고(개인 확정본) = 기존 weekly_folder(20261124203000), 팀 보고 취합(팀 확정본) = 이 칸.
-- 폴더 이름·경로는 코드·DB에 박지 않는다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 무엇: public.app_profiles.weekly_team_folder uuid 칸 하나(사람마다 팀 보고 취합 저장 폴더, 비어 있음 = 아직 안 정함 → 처음 저장 때 묻는다).
--   weekly_folder와 같은 모양: 폴더 표를 가리키고 폴더가 실제로 지워지면 저절로 비워진다(on delete set null).
--   화면은 내 프로필 행의 이 칸만 PATCH한다(task12a owner 정책·기존 표 UPDATE 권한 그대로, 새 권한 없음). 이 칸은 화면이 폴더를 고르는 데만 쓰고
--   서버 권한 판단에 쓰지 않는다. 자료를 폴더에 넣는 쓰기는 기존 폴더 연결 표(app_library_folder_items) owner RLS 그대로다.
-- 안 하는 것: 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경(weekly_folder 값 그대로), anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 짝: docs/20261125193000_profile_weekly_team_folder.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125193000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261124203000' and name = 'profile_weekly_folder') <> 1
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_profiles') and not attisdropped
           and attname = 'weekly_folder' and atttypid = 'uuid'::regtype) <> 1
     or to_regclass('public.app_library_folders') is null
     or to_regclass('public.app_profiles') is null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_library_folders') and not attisdropped
           and attname = 'id' and atttypid = 'uuid'::regtype) <> 1
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_profiles') and attname = 'weekly_team_folder' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_profiles') and conname = 'app_profiles_weekly_team_folder_fkey')
     or to_regclass('public.app_profiles_weekly_team_folder_idx') is not null
     or exists (select 1 from pg_class where oid in (to_regclass('public.app_library_folders'), to_regclass('public.app_profiles'))
           and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then
    raise exception 'PROFILE_WEEKLY_TEAM_FOLDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles
  add column weekly_team_folder uuid,
  add constraint app_profiles_weekly_team_folder_fkey foreign key (weekly_team_folder)
    references public.app_library_folders(id) on delete set null;
create index app_profiles_weekly_team_folder_idx on public.app_profiles(weekly_team_folder)
  where weekly_team_folder is not null;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_profiles'::regclass and attname = 'weekly_team_folder' and not attisdropped
                   and atttypid = 'uuid'::regtype and not attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_weekly_team_folder_fkey' and contype = 'f' and confdeltype = 'n') <> 1
     or to_regclass('public.app_profiles_weekly_team_folder_idx') is null
     or has_any_column_privilege('anon', 'public.app_profiles'::regclass, 'select,insert,update,references')
     or exists (select 1 from pg_class where oid in ('public.app_library_folders'::regclass, 'public.app_profiles'::regclass) and not relrowsecurity) then
    raise exception 'PROFILE_WEEKLY_TEAM_FOLDER_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125193000', 'profile_weekly_team_folder', array['S70-11 WEEKLY-저장폴더나누기: app_profiles adds nullable uuid weekly_team_folder (fk app_library_folders on delete set null, partial index app_profiles_weekly_team_folder_idx); no policy, table grant, function, trigger or RLS change']);
commit;
