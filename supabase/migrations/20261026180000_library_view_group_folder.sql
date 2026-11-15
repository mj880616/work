begin;
-- LIB-폴더묶기기억 (2026-10-26 사용자 결정 16:03 "기억"): 자료실 '묶기'에서 '폴더'를 골라도 내 프로필(app_profiles.library_view)에 저장해 PC와 폰이 같게 열리게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_library_view_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦): group_by 허용값 project·organization·category·month → 여기에 folder 추가.
--   다른 규칙(칸은 group_by·categories_off 둘뿐, 꺼 둔 종류 0~60개·각 1~40자, 전체 4000바이트 상한)은 글자 그대로 같다. 기존 행은 건드리지 않는다.
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 칸 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록 있음, library_view 칸 있음, 검사 1개(검증됨, 아직 folder 없음),
-- RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026180000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023150000' and name = 'profile_library_view') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'library_view') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_view_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_library_view_check'
           and check_clause ~ 'organization' and check_clause !~ 'folder') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_FOLDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_library_view_check;
alter table public.app_profiles
  add constraint app_profiles_library_view_check check (
    library_view is null or (
      jsonb_typeof(library_view) = 'object'
      and octet_length(library_view::text) <= 4000
      -- 칸은 group_by·categories_off 둘뿐.
      and not jsonb_path_exists(library_view, 'strict $.keyvalue() ? (!(@.key == "group_by" || @.key == "categories_off"))')
      -- 묶기: 프로젝트·담당조직·종류·월별·폴더 다섯 중 하나(글자여야 한다).
      and (not (library_view ? 'group_by') or (
        jsonb_typeof(library_view -> 'group_by') = 'string'
        and library_view ->> 'group_by' in ('project', 'organization', 'category', 'month', 'folder')
      ))
      -- 꺼 둔 종류: 배열 0~60개, 각 이름은 1~40자 글자(앞뒤 공백·제어문자 없음).
      and (not (library_view ? 'categories_off') or (
        jsonb_typeof(library_view -> 'categories_off') = 'array'
        and jsonb_array_length(library_view -> 'categories_off') <= 60
        and not jsonb_path_exists(library_view, 'strict $.categories_off[*] ? (@.type() != "string")')
        and not jsonb_path_exists(library_view, 'lax $.categories_off[*] ? (!(@ like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,38}[^[:cntrl:][:space:]])?$"))')
      ))
    )
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 1개가 검증된 상태에서 folder를 받고, 모든 프로필 값은 그대로 유효. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_view_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_library_view_check' and check_clause ~ 'folder') <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_FOLDER_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026180000', 'library_view_group_folder', array['LIB-폴더묶기기억: app_profiles_library_view_check group_by accepts "folder" (no new column, grants, policies or functions)']);
commit;
