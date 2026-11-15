begin;
-- S62-24 PROFILE-소속칸글로쓰기 + 덧붙임(명진 확정 11/15 21:45·21:48): 내 프로필 기본 정보에 '노조명'·'부서명' 글 칸 두 개를 더한다.
-- 이름(display_name)·직책(job_title)과 같은 표·같은 저장 길(내 프로필 [저장] → 내 행 PATCH). 가입 때 받지 않고 프로필에서 채운다. 목록·자동완성·승인 없음(표시용 이름표).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). 화면 PR은 적용 뒤.
--
-- 무엇: app_profiles.union_name text null · department_name text null 칸 둘과 값 모양 검사 둘.
--   값은 없음(null) 또는 1~60자 한 줄 글자(제어문자·줄바꿈 없음, 공백만은 안 됨). 화면은 앞뒤 공백을 지우고 빈 칸은 null로 보낸다.
-- 기존 행은 모두 빈 값(null)으로 시작한다(기본값 없음, 표를 다시 쓰지 않음, 기존 데이터 변경 없음).
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수·트리거 없음. 읽기·쓰기는 지금 이름·직책과 같다(task12a owner 정책 두 개 그대로 — 내 행만, 다른 작업공간에는 안 보임).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
-- 짝 rollback은 어떤 프로필이든 두 칸 중 하나라도 저장돼 있으면 멈춘다(적은 글이 사라지므로).
-- 짝: docs/20261115223000_profile_union_department.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115223000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261111100500' and name = 'profile_meeting_name_presets') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname in ('union_name', 'department_name'))
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace
         and conname in ('app_profiles_union_name_check', 'app_profiles_department_name_check'))
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로.
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_UNION_DEPARTMENT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles
  add column union_name text,
  add column department_name text;
alter table public.app_profiles
  add constraint app_profiles_union_name_check check (
    union_name is null or (char_length(union_name) between 1 and 60 and union_name !~ '[[:cntrl:]]' and union_name ~ '[^[:space:]]')
  ),
  add constraint app_profiles_department_name_check check (
    department_name is null or (char_length(department_name) between 1 and 60 and department_name !~ '[[:cntrl:]]' and department_name ~ '[^[:space:]]')
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 빈 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where union_name is not null or department_name is not null) then
    raise exception 'PROFILE_UNION_DEPARTMENT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115223000', 'profile_union_department', array['S62-24 PROFILE-union-department: app_profiles.union_name text null + department_name text null, CHECK each null or 1-60 chars one line not blank; own profile via existing owner RLS, no grants/policies/functions/rows changed']);
commit;
