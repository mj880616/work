begin;
-- JOURNAL-주간정리다듬기 ③ (2026-10-22 사용자 결정): 회의·행사 결과에서 정기 내부 회의를 빼고, 회의 종류마다 "주간보고에 올림" 표시.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 내 프로필(app_profiles)에 "주간보고에 올리지 않을 회의 종류" 목록 칸 하나를 더한다.
--   - 회의 종류 = 회의의 series_name(없으면 title)을 띄어쓰기 없이·소문자로 맞춘 이름(app/team.js meetingNameKey와 같은 규칙).
--   - 목록에 없는 종류는 "올림"이다. 그래서 새로 생기는 회의 종류는 저절로 "올림"이 된다.
--   - 기본값: '궤도집행국회의', '본부집행위' 두 종류만 "올리지 않음"(2026-10-22 사용자 승인). 기존 행도 이 값으로 채워진다.
--   - 행사(기자회견·토론회 등)도 회의 행이므로 같은 규칙: 목록에 넣지 않는 한 그대로 올라간다.
-- 권한: 표 grant·정책·RLS 변경 없음. 기존 owner 정책(task12a_owner_all / task12a_profile_self_select) 그대로 자기 행만 읽고 쓴다.
--   새 함수 없음(화면은 기존 내 프로필 저장처럼 내 행 PATCH). 기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022090000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261018112943' and name = 'doc_categories_profile') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'weekly_hidden_meeting_kinds')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_weekly_hidden_meeting_kinds_check')
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
    raise exception 'WEEKLY_MEETING_KINDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 주간보고에 올리지 않을 회의 종류(이름 키). 0~100개, 이름 1~100자, null·빈 이름·겹침 없음.
-- 값은 화면이 meetingNameKey 규칙(띄어쓰기 없음·소문자)으로 맞춰 쓴다. 표는 모양만 검사한다.
alter table public.app_profiles
  add column weekly_hidden_meeting_kinds text[] not null
    default array['궤도집행국회의', '본부집행위']::text[];
alter table public.app_profiles
  add constraint app_profiles_weekly_hidden_meeting_kinds_check check (
    -- CHECK 안에서는 하위 질의를 쓸 수 없어 20261018112943처럼 쉼표로 이어 붙여 검사한다.
    cardinality(weekly_hidden_meeting_kinds) <= 100
    and array_position(weekly_hidden_meeting_kinds, null) is null
    and (cardinality(weekly_hidden_meeting_kinds) = 0 or (
      array_ndims(weekly_hidden_meeting_kinds) = 1
      and array_lower(weekly_hidden_meeting_kinds, 1) = 1
      -- 쉼표가 든 이름은 칸 수가 달라져 걸린다.
      and cardinality(weekly_hidden_meeting_kinds) = cardinality(string_to_array(array_to_string(weekly_hidden_meeting_kinds, ','), ','))
      -- 이름마다 1~100자, 공백·제어문자·쉼표 없음(이름 키는 띄어쓰기를 뺀 값).
      and array_to_string(weekly_hidden_meeting_kinds, ',') ~ '^[^,[:cntrl:][:space:]]{1,100}(,[^,[:cntrl:][:space:]]{1,100})*$'
      -- 같은 이름 두 번 금지.
      and array_to_string(weekly_hidden_meeting_kinds, ',') !~ '(^|,)([^,]+),(.*,)?\2(,|$)'
    ))
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필이 기본값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles
         where weekly_hidden_meeting_kinds is distinct from array['궤도집행국회의', '본부집행위']::text[]) then
    raise exception 'WEEKLY_MEETING_KINDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022090000', 'weekly_report_meeting_kinds', array['JOURNAL-주간정리다듬기 ③: app_profiles.weekly_hidden_meeting_kinds text[] + CHECK (own profile via existing owner RLS, no grants/policies)']);
commit;
