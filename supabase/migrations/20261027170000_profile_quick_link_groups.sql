begin;
-- UI-자주가는링크편집 (2026-10-27 명진 요청 16:02·시안 승인): 자주 가는 링크 창에서 분류(지금 '업무'·'담당조직 홈페이지')를 더하고, 이름을 바꾸고, 지우고, 순서를 옮길 수 있게
-- 분류 목록과 순서를 내 프로필(app_profiles)에 함께 둔다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇:
--   1) app_profiles.quick_link_groups jsonb 칸 하나(비어 있음 = 아직 분류를 고친 적 없음 → 화면이 코드의 두 분류 '업무'(work)·'담당조직 홈페이지'(org)를 보여 줌).
--      값 모양: [{"id":"work","name":"업무"}, …] 배열 순서가 화면의 분류 순서. 1~12개, 칸은 id·name 둘뿐,
--      id는 영문 소문자·숫자 1~12자, 이름은 1~20자 글자(앞뒤 공백·제어문자 없음), 전체 4000바이트 상한.
--   2) app_profiles_quick_links_check(링크 목록 검사)를 지우고 같은 이름으로 다시 만든다: 링크의 group이 'work'·'org' 둘뿐이던 것을 분류 id 모양(영문 소문자·숫자 1~12자)으로 넓힌다.
--      나머지 규칙(0~60개, 칸은 group·name·url 셋뿐, 이름 1~40자, 주소는 http·https로 시작, 전체 150000바이트 상한)은 같고,
--      세 칸이 모두 있어야 하고 모두 글자여야 한다는 점만 분명히 했다. 기존에 저장된 목록(group이 work·org)은 새 검사도 그대로 통과한다.
--   3) app_profiles_quick_links_group_ref_check: 링크의 group은 같은 행의 분류 목록(비어 있으면 work·org)에 있는 id여야 한다.
--      분류와 링크를 한 번의 PATCH로 같이 저장하므로 둘은 항상 맞는 채로만 저장된다.
--   기존 행은 비어 있는 칸을 더할 뿐 다시 쓰지 않는다. 이미 저장된 링크 목록은 그대로 둔다.
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때, 그리고 앞선 profile_quick_links가 적용돼 있을 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027170000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022163000' and name = 'profile_quick_links') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'quick_links') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'quick_link_groups')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_profiles'::regclass
         and conname in ('app_profiles_quick_link_groups_check', 'app_profiles_quick_links_group_ref_check'))
     -- 지금 링크 검사는 하나이고 검증된 상태다(모양은 짝 사전 확인 SQL이 pg_get_constraintdef로 따로 본다).
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_quick_links_check'
         and contype = 'c' and convalidated) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_QUICK_LINK_GROUPS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 분류 목록. 비어 있으면(null) 화면이 work·org 두 분류를 보여 준다.
alter table public.app_profiles
  add column quick_link_groups jsonb;
alter table public.app_profiles
  add constraint app_profiles_quick_link_groups_check check (
    quick_link_groups is null or (
      jsonb_typeof(quick_link_groups) = 'array'
      and jsonb_array_length(quick_link_groups) between 1 and 12
      and octet_length(quick_link_groups::text) <= 4000
      -- 항목은 객체이고 칸은 id·name 둘뿐, 둘 다 있어야 하고 글자여야 한다.
      and not jsonb_path_exists(quick_link_groups, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(quick_link_groups, 'strict $[*].keyvalue() ? (!(@.key == "id" || @.key == "name"))')
      and not jsonb_path_exists(quick_link_groups, 'lax $[*] ? (!(exists(@.id) && exists(@.name)))')
      and not jsonb_path_exists(quick_link_groups, 'lax $[*] ? (!(@.id.type() == "string" && @.name.type() == "string"))')
      -- id: 영문 소문자·숫자 1~12자. 이름: 1~20자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(quick_link_groups, 'lax $[*] ? (!(@.id like_regex "^[a-z0-9]{1,12}$"))')
      and not jsonb_path_exists(quick_link_groups, 'lax $[*] ? (!(@.name like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,18}[^[:cntrl:][:space:]])?$"))')
    )
  );

-- 링크 검사: group을 work·org 둘에서 분류 id 모양으로. 지우고 같은 이름으로 다시 만든다(기존 행은 새 검사도 통과해야 하며, 아니면 아래 add가 실패해 전체 취소).
alter table public.app_profiles drop constraint app_profiles_quick_links_check;
alter table public.app_profiles
  add constraint app_profiles_quick_links_check check (
    quick_links is null or (
      jsonb_typeof(quick_links) = 'array'
      and jsonb_array_length(quick_links) <= 60
      and octet_length(quick_links::text) <= 150000
      -- 항목은 객체이고 칸은 group·name·url 셋뿐, 셋 다 있어야 하고 글자여야 한다.
      and not jsonb_path_exists(quick_links, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(quick_links, 'strict $[*].keyvalue() ? (!(@.key == "group" || @.key == "name" || @.key == "url"))')
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(exists(@.group) && exists(@.name) && exists(@.url)))')
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.group.type() == "string" && @.name.type() == "string" && @.url.type() == "string"))')
      -- 분류: id 모양(영문 소문자·숫자 1~12자). 그 id가 분류 목록에 있는지는 아래 group_ref 검사가 본다.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.group like_regex "^[a-z0-9]{1,12}$"))')
      -- 이름: 1~40자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.name like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,38}[^[:cntrl:][:space:]])?$"))')
      -- 주소: http:// 또는 https://로 시작, 공백·제어문자 없음. (정규식 반복 상한 때문에 주소 길이는 전체 크기 상한으로 막고, 화면이 2000자로 거절한다.)
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.url like_regex "^[hH][tT][tT][pP][sS]?://[^[:cntrl:][:space:]]+$"))')
    )
  );
alter table public.app_profiles
  add constraint app_profiles_quick_links_group_ref_check check (
    quick_links is null or not jsonb_path_exists(
      quick_links,
      'lax $[*] ? (!(@.group == $ids[*]))',
      jsonb_build_object('ids', coalesce(jsonb_path_query_array(quick_link_groups, '$[*].id'), '["work","org"]'::jsonb))
    )
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 셋이 모두 검증된 상태, 새 칸은 모든 프로필에서 비어 있음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and convalidated
         and conname in ('app_profiles_quick_links_check', 'app_profiles_quick_link_groups_check', 'app_profiles_quick_links_group_ref_check')) <> 3
     or exists (select 1 from public.app_profiles where quick_link_groups is not null) then
    raise exception 'PROFILE_QUICK_LINK_GROUPS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027170000', 'profile_quick_link_groups', array['UI-자주가는링크편집: app_profiles.quick_link_groups jsonb + CHECK, app_profiles_quick_links_check group widened to category ids, group_ref CHECK (own profile via existing owner RLS, no grants/policies/functions)']);
commit;
