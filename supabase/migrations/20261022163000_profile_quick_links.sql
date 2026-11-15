begin;
-- UI-자주가는링크 (2026-10-22 사용자 승인 08:23·08:29): PC 사이드바 '자주 가는 링크' 창의 링크 목록을 내 프로필(app_profiles) 칸 하나에 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles.quick_links jsonb 칸 하나(비어 있음 = 아직 고친 적 없음 → 화면이 코드의 초기 링크를 보여 줌).
--   값 모양: [{"group":"work"|"org","name":"이름","url":"https://…"}, …] 배열 순서가 화면 순서.
--   - 0~60개, 칸은 group·name·url 셋뿐, 이름 1~40자(앞뒤 공백·제어문자 없음), 주소는 http:// 또는 https://로 시작하고 공백·제어문자 없음(길이는 목록 전체 150000바이트 상한, 화면은 주소 2000자).
--   - javascript: 같은 다른 주소는 표가 거절한다(화면도 같은 규칙으로 먼저 거절).
--   - 기존 행은 비어 있는 채로 둔다(표를 다시 쓰지 않음).
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존 내 프로필 저장처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022163000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261018112943' and name = 'doc_categories_profile') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'quick_links')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_quick_links_check')
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
    raise exception 'PROFILE_QUICK_LINKS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 링크 목록. 비어 있으면(null) 화면이 초기 링크를 보여 준다.
alter table public.app_profiles
  add column quick_links jsonb;
alter table public.app_profiles
  add constraint app_profiles_quick_links_check check (
    quick_links is null or (
      jsonb_typeof(quick_links) = 'array'
      and jsonb_array_length(quick_links) <= 60
      and octet_length(quick_links::text) <= 150000
      -- 항목은 객체이고 칸은 group·name·url 셋뿐.
      and not jsonb_path_exists(quick_links, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(quick_links, 'strict $[*].keyvalue() ? (!(@.key == "group" || @.key == "name" || @.key == "url"))')
      -- 묶음은 업무(work)·담당조직 홈페이지(org) 둘.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.group == "work" || @.group == "org"))')
      -- 이름·주소는 글자(문자열)여야 한다(숫자·null 등은 아래 정규식 검사를 빠져나가므로 먼저 막는다).
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.name.type() == "string" && @.url.type() == "string"))')
      -- 이름: 1~40자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.name like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,38}[^[:cntrl:][:space:]])?$"))')
      -- 주소: http:// 또는 https://로 시작, 공백·제어문자 없음. (정규식 반복 상한 때문에 주소 길이는 전체 크기 상한으로 막고, 화면이 2000자로 거절한다.)
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.url like_regex "^[hH][tT][tT][pP][sS]?://[^[:cntrl:][:space:]]+$"))')
    )
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 비어 있음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where quick_links is not null) then
    raise exception 'PROFILE_QUICK_LINKS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022163000', 'profile_quick_links', array['UI-자주가는링크: app_profiles.quick_links jsonb + CHECK (own profile via existing owner RLS, no grants/policies/functions)']);
commit;
