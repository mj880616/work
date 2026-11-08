begin;
-- S53-20 MTG-비정기회의접기 ①(요청 11/08, 시안 docs/design/mockups/meeting-name-irregular.html): 사업 보고 '회의명' 목록에 한 번 쓰고 말 수도 있는
-- 비정기 회의가 쌓이지 않게, 회의명마다 '정기/비정기'와 상위를 내 프로필에 기억한다(서버 저장·내 작업공간, 로컬 저장 금지).
-- 회의명 목록 자체는 지금처럼 내 회의 기록(app_meetings의 series_name, 없으면 title)에서 나온다. 이 칸은 그 목록을 어떻게 보일지만 담는다.
-- 회의 종류 빼기(weekly_hidden_meeting_kinds)·주간보고 일정 기억(weekly_schedule_memory)과 같은 "내 프로필 칸" 방식이다. 새 표·새 함수 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles.meeting_name_sorts jsonb not null default '{}' 칸 하나와 값 모양 검사 하나.
--   {parents?, names?} 두 칸뿐.
--     parents  상위 목록(순서 = 화면 순서) [{id, name}] 30개까지. id = 'g' + 소문자 영문·숫자 6~12자, name = 1~30자 한 줄(공백만은 안 됨).
--              처음 값은 없다(빈 상위 목록 + 화면의 '기타 비정기' 묶음으로 시작, 상위는 사용자가 화면에서 더한다).
--     names    회의명 열쇠(띄어쓰기 없이·소문자, app/team.js meetingNameKey와 같은 규칙, 1~100자, 공백·쉼표·제어문자 없음) → 표시 300개까지.
--              표시 = 'etc'(비정기 · 기타 비정기 묶음) | 'del'(목록에서 지움) | 상위 id(비정기 · 그 상위 아래). 없는 회의명은 정기(지금처럼 목록에 보임).
--   전체 32 KiB(32,768바이트)까지. 검사는 칸마다 CASE로 순서를 고정해 모양이 틀린 값도 오류가 아니라 거절로 끝난다.
--   상위 id가 parents에 있는지는 CHECK로 막기 어려워 화면이 맞춘다(없는 상위 id는 '기타 비정기'로 보인다).
-- 기존 행은 모두 빈 값 {}으로 시작한다(상수 기본값, 표를 다시 쓰지 않음, 기존 데이터 변경 없음). 회의 기록·보고 글은 건드리지 않는다.
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존 내 프로필 저장처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
-- 짝 rollback은 어떤 프로필이든 정리가 하나라도 저장돼 있으면 멈춘다(정리가 사라지므로).
-- 짝: docs/20261108090000_profile_meeting_name_sorts.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108090000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261024002000' and name = 'profile_weekly_schedule_memory') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'meeting_name_sorts')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_meeting_name_sorts_check')
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로(20261024002000 사전 확인과 같은 모양).
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_MEETING_NAME_SORTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles
  add column meeting_name_sorts jsonb not null default '{}'::jsonb;
alter table public.app_profiles
  add constraint app_profiles_meeting_name_sorts_check check (
    case
      when jsonb_typeof(meeting_name_sorts) <> 'object' then false
      else
        octet_length(meeting_name_sorts::text) <= 32768
        -- 칸은 parents·names 둘뿐.
        and not jsonb_path_exists(meeting_name_sorts, 'strict $.keyvalue() ? (!(@.key == "parents" || @.key == "names"))')
        -- 상위 목록: 배열 30개까지, 칸마다 객체 {id, name} 둘뿐. id = 'g' + 소문자 영문·숫자 6~12자, name = 1~30자 한 줄(공백만은 안 됨).
        and case when not (meeting_name_sorts ? 'parents') then true
              when jsonb_typeof(meeting_name_sorts -> 'parents') <> 'array' then false
              when jsonb_array_length(meeting_name_sorts -> 'parents') > 30 then false
              when jsonb_path_exists(meeting_name_sorts, 'strict $.parents[*] ? (@.type() != "object")') then false
              else not jsonb_path_exists(meeting_name_sorts, 'strict $.parents[*].keyvalue() ? (!(@.key == "id" || @.key == "name"))')
               and jsonb_array_length(jsonb_path_query_array(meeting_name_sorts, 'lax $.parents[*] ? (@.id.type() == "string" && @.id like_regex "^g[0-9a-z]{6,12}$" && @.name.type() == "string" && @.name like_regex "^[^[:cntrl:]]{1,30}$" && @.name like_regex "[^[:space:]]")'))
                   = jsonb_array_length(meeting_name_sorts -> 'parents') end
        -- 회의명 표시: 객체 300칸까지. 칸 이름 = 회의명 열쇠(1~100자, 공백·쉼표·제어문자 없음), 값 = 'etc' | 'del' | 상위 id 모양 글자.
        and case when not (meeting_name_sorts ? 'names') then true
              when jsonb_typeof(meeting_name_sorts -> 'names') <> 'object' then false
              when jsonb_array_length(jsonb_path_query_array(meeting_name_sorts, 'strict $.names.keyvalue().key')) > 300 then false
              else not jsonb_path_exists(meeting_name_sorts, 'strict $.names.keyvalue() ? (!(@.key like_regex "^[^[:cntrl:][:space:],]{1,100}$"))')
               and not jsonb_path_exists(meeting_name_sorts, 'strict $.names.* ? (@.type() != "string" || !(@ like_regex "^(etc|del|g[0-9a-z]{6,12})$"))') end
    end
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 빈 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where meeting_name_sorts <> '{}'::jsonb) then
    raise exception 'PROFILE_MEETING_NAME_SORTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108090000', 'profile_meeting_name_sorts', array['S53-20 MTG-irregular: app_profiles.meeting_name_sorts jsonb not null default {} + CHECK (parents up to 30 {id,name}, names up to 300 key -> etc|del|parent id, 32 KiB; own profile via existing owner RLS, no grants/policies/functions)']);
commit;
