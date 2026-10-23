begin;
-- WEEKLY-환류 DB (docs/design/weekly-draft-feedback.md 3.5·4.2, 명진 결정 2026-10-23 23:09): [확정] 때 달력 제목과 다르게 고친 일정 이름·뺀 일정을
-- "원래 제목"을 열쇠로 내 프로필 칸 하나에 기억해 다음 주 초안에 먼저 적용한다. 회의 종류 빼기(weekly_hidden_meeting_kinds)·보기 설정(view_prefs)과
-- 같은 "내 프로필 칸" 방식이다. 새 표·새 함수 없음. Google Calendar 원본은 건드리지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles.weekly_schedule_memory jsonb not null default '[]' 칸 하나와 값 모양 검사 하나.
--   항목 하나 = {key, origin, title?, place?, drop?, saved, used?}
--     key     원래 제목을 띄어쓰기 없이·소문자로 맞춘 열쇠(1~200자)         origin  목록에 보일 원래 제목(1~200자)
--     title   고친 이름(1~200자)                                          place   고친 장소(1~100자)
--     drop    true = 이 제목 일정은 계속 뺀다                              saved   기억한 날 YYYY-MM-DD       used  마지막으로 초안에 적용된 날 YYYY-MM-DD
--   검사: 배열, 200개까지, 전체 64 KiB(65,536바이트)까지, 항목은 객체, 칸은 위 일곱 개뿐, key·origin·saved 필수, 글은 한 줄(제어문자 없음)·빈 글 불가,
--   title과 drop은 둘 중 하나만(둘 다 없거나 둘 다 있으면 거절, drop은 true만), place는 title이 있을 때만. 열쇠 중복은 CHECK로 막기 어려워
--   화면이 다시 읽고 합친다(설계 6절 위험 5).
--   검사는 칸마다 CASE로 순서를 고정해(앞 조건이 틀리면 뒤 조건은 보지 않음) 모양이 틀린 값도 오류가 아니라 거절로 끝난다.
-- 기존 행은 모두 빈 목록 []으로 시작한다(상수 기본값, 표를 다시 쓰지 않음, 기존 데이터 변경 없음).
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존 내 프로필 저장처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
-- 짝 rollback은 어떤 프로필이든 기억이 한 항목이라도 있으면 멈춘다(기억이 사라지므로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024002000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023180000' and name = 'profile_view_prefs') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'weekly_schedule_memory')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_weekly_schedule_memory_check')
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로(20261023180000 사전 확인과 같은 모양).
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_WEEKLY_SCHEDULE_MEMORY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles
  add column weekly_schedule_memory jsonb not null default '[]'::jsonb;
alter table public.app_profiles
  add constraint app_profiles_weekly_schedule_memory_check check (
    case
      when jsonb_typeof(weekly_schedule_memory) <> 'array' then false
      else
        jsonb_array_length(weekly_schedule_memory) <= 200
        and octet_length(weekly_schedule_memory::text) <= 65536
        and not jsonb_path_exists(weekly_schedule_memory, 'strict $[*] ? (@.type() != "object")')
        -- 칸은 아래 일곱 개뿐, key·origin·saved 필수.
        and not jsonb_path_exists(weekly_schedule_memory, 'strict $[*].keyvalue() ? (!(@.key == "key" || @.key == "origin" || @.key == "title" || @.key == "place" || @.key == "drop" || @.key == "saved" || @.key == "used"))')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*] ? (!exists(@.key) || !exists(@.origin) || !exists(@.saved))')
        -- 글 칸은 모두 글자. drop은 true만.
        and not jsonb_path_exists(weekly_schedule_memory, 'strict $[*].keyvalue() ? (@.key != "drop" && @.value.type() != "string")')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].drop ? (@.type() != "boolean" || @ != true)')
        -- 한 줄(제어문자 없음)·빈 글 불가·길이 상한.
        and not jsonb_path_exists(weekly_schedule_memory, 'strict $[*].keyvalue() ? (@.key != "drop" && @.value like_regex "[\u0001-\u001f\u007f]")')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].key ? (!(@ like_regex "[^[:space:]]") || @ like_regex "^.{201}")')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].origin ? (!(@ like_regex "[^[:space:]]") || @ like_regex "^.{201}")')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].title ? (!(@ like_regex "[^[:space:]]") || @ like_regex "^.{201}")')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].place ? (!(@ like_regex "[^[:space:]]") || @ like_regex "^.{101}")')
        -- 날짜는 YYYY-MM-DD.
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].saved ? (!(@ like_regex "^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"))')
        and not jsonb_path_exists(weekly_schedule_memory, '$[*].used ? (!(@ like_regex "^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"))')
        -- title과 drop은 둘 중 하나만, place는 title이 있을 때만.
        and not jsonb_path_exists(weekly_schedule_memory, '$[*] ? ((exists(@.title) && exists(@.drop)) || (!exists(@.title) && !exists(@.drop)) || (exists(@.place) && !exists(@.title)))')
    end
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 빈 목록. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where weekly_schedule_memory <> '[]'::jsonb) then
    raise exception 'PROFILE_WEEKLY_SCHEDULE_MEMORY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024002000', 'profile_weekly_schedule_memory', array['WEEKLY-환류 DB: app_profiles.weekly_schedule_memory jsonb not null default [] + CHECK (own profile via existing owner RLS, no grants/policies/functions)']);
commit;
