begin;
-- LIB-폴더보기 칩 순서 (2026-10-28 08:25 요청 ②, 11:53 명진 결정 ① 'ㅇ'): 자료실 묶기 칩 순서([폴더] 맨 앞, 꾹 눌러 끌어 바꿈)를 PC와 폰이 같은 값으로 서버에서 읽게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_library_view_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦): 칸 이름 group_by·categories_off·recent_folders 셋 → 여기에 group_order 추가.
--   group_order = 묶기 값(project·organization·category·month·folder) 글자 배열 0~5개, 맨 앞이 칩 줄 맨 앞. 빠진 값은 화면이 기본 순서로 뒤에 붙인다.
--   다른 규칙(group_by 다섯 값, 꺼 둔 종류 0~60개·각 1~40자, 최근 넣은 폴더 0~5개 uuid, 전체 4000바이트 상한)은 글자 그대로 같다. 기존 행은 건드리지 않는다.
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 칸 없음(library_view 안의 키 하나). 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
-- 이 파일이 적용되기 전에는 화면이 group_order 저장을 400으로 거절당해도 묵묵히 건너뛰고(이번 방문 동안만 기억) 다른 보기 저장은 그대로 한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(폴더 묶기) 있음, library_view 칸 있음, 검사 1개(검증됨; 검사 내용은 짝 사전 확인 파일이 읽기 전용으로 확인),
-- RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028140000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261027173000' and name = 'library_view_recent_folders') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'library_view') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_view_check'
         and contype = 'c' and convalidated) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_ORDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_library_view_check;
alter table public.app_profiles
  add constraint app_profiles_library_view_check check (
    library_view is null or (
      jsonb_typeof(library_view) = 'object'
      and octet_length(library_view::text) <= 4000
      -- 칸은 group_by·categories_off·recent_folders·group_order 넷뿐.
      and not jsonb_path_exists(library_view, 'strict $.keyvalue() ? (!(@.key == "group_by" || @.key == "categories_off" || @.key == "recent_folders" || @.key == "group_order"))')
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
      -- 최근 넣은 폴더: 배열 0~5개, 모두 소문자 uuid 모양 글자(36자). 중복은 화면이 막고 DB 검사는 보지 않는다(검사식에는 하위 조회를 쓸 수 없고, 중복이 있어도 해롭지 않다).
      and (not (library_view ? 'recent_folders') or (
        jsonb_typeof(library_view -> 'recent_folders') = 'array'
        and jsonb_array_length(library_view -> 'recent_folders') <= 5
        and not jsonb_path_exists(library_view, 'strict $.recent_folders[*] ? (@.type() != "string")')
        and not jsonb_path_exists(library_view, 'lax $.recent_folders[*] ? (!(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')
      ))
      -- 묶기 칩 순서: 배열 0~5개, 각 값은 묶기 다섯 값 중 하나(글자). 맨 앞이 칩 줄 맨 앞. 빠진 묶기는 화면이 기본 순서로 뒤에 붙인다.
      and (not (library_view ? 'group_order') or (
        jsonb_typeof(library_view -> 'group_order') = 'array'
        and jsonb_array_length(library_view -> 'group_order') <= 5
        and not jsonb_path_exists(library_view, 'strict $.group_order[*] ? (@.type() != "string")')
        and not jsonb_path_exists(library_view, 'lax $.group_order[*] ? (!(@ == "project" || @ == "organization" || @ == "category" || @ == "month" || @ == "folder"))')
      ))
    )
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 1개가 검증된 상태로 남는다(group_order 허용 여부는 짝 사후 확인 파일이 읽는다). 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_view_check'
         and convalidated) <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_ORDER_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028140000', 'library_view_group_order', array['LIB-폴더보기: app_profiles_library_view_check also accepts group_order (group value string array, max 5; no new column, grants, policies or functions)']);
commit;
