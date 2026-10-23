begin;
-- LIB-보기기억 (2026-10-23 사용자 요청 11:47): 자료실에서 마지막으로 고른 묶기·종류 칩을 내 프로필(app_profiles) 칸 하나에 두어 PC와 폰이 같게 열리게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles.library_view jsonb 칸 하나(비어 있음 = 아직 고른 적 없음 → 화면이 코드의 기본: 묶기 프로젝트, 종류는 [회의]만 꺼짐).
--   값 모양: {"group_by":"project"|"organization"|"category"|"month","categories_off":["회의",…]} — 두 칸 모두 선택(없을 수 있음), 다른 칸은 거절.
--   - categories_off: 0~60개, 각 이름 1~40자(앞뒤 공백·제어문자 없음). 꺼 둔 종류를 이름으로 기억하므로 새 분류는 켜진 채로 보인다.
--   - 전체 크기 상한 4000바이트. 기존 행은 비어 있는 채로 둔다(표를 다시 쓰지 않음).
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존 내 프로필 저장처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때, 그리고 앞선 profile_quick_links가 적용돼 있을 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023150000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022163000' and name = 'profile_quick_links') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'library_view')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_library_view_check')
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로(20261018112943 사전 확인과 같은 모양).
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 자료실 보기 기억. 비어 있으면(null) 화면이 기본을 보여 준다.
alter table public.app_profiles
  add column library_view jsonb;
alter table public.app_profiles
  add constraint app_profiles_library_view_check check (
    library_view is null or (
      jsonb_typeof(library_view) = 'object'
      and octet_length(library_view::text) <= 4000
      -- 칸은 group_by·categories_off 둘뿐.
      and not jsonb_path_exists(library_view, 'strict $.keyvalue() ? (!(@.key == "group_by" || @.key == "categories_off"))')
      -- 묶기: 프로젝트·담당조직·종류·월별 넷 중 하나(글자여야 한다).
      and (not (library_view ? 'group_by') or (
        jsonb_typeof(library_view -> 'group_by') = 'string'
        and library_view ->> 'group_by' in ('project', 'organization', 'category', 'month')
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

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 비어 있음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where library_view is not null) then
    raise exception 'PROFILE_LIBRARY_VIEW_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023150000', 'profile_library_view', array['LIB-보기기억: app_profiles.library_view jsonb + CHECK (own profile via existing owner RLS, no grants/policies/functions)']);
commit;
