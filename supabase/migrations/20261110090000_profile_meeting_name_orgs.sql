begin;
-- S56-1 MTG-회의명조직묶기(명진 승인 11/10 11:05, 시안 docs/design/mockups/meeting-name-groups.html): 사업 보고 '회의명' 고르기 창을 조직별로 묶으려고,
-- 정기 회의에도 조직을 붙일 자리를 내 프로필 칸 meeting_name_sorts에 더한다(서버 저장·내 작업공간, 로컬 저장 금지). 기존 '상위'(parents)를 그대로 '조직'으로 쓴다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_meeting_name_sorts_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 20261108090000 profile_meeting_name_sorts 판 글자 그대로에
--   orgs 칸 하나를 더한다. orgs = {회의명 열쇠: 조직(상위) id} 300칸까지(열쇠 규칙은 names와 같음, 값은 'g' + 소문자 영문·숫자 6~12자).
--   다른 칸 규칙·32 KiB 상한은 글자 그대로 같다(넓히기만). 옛 값은 그대로 통과한다. 기존 행은 건드리지 않는다(회의 기록·보고 글도 그대로).
-- 권한: grant·revoke·정책·RLS·함수·트리거·새 열 변경 없음. 프로필 정책은 task12a 두 개 그대로.
-- 앞 단계: 20261108090000_profile_meeting_name_sorts(S53-20) 기록과 칸·검사가 있어야 한다(없으면 멈춘다).
-- 짝: docs/20261110090000_profile_meeting_name_orgs.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110090000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261108090000' and name = 'profile_meeting_name_sorts') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'meeting_name_sorts') <> 1
     -- 검사는 20261108090000 판(parents·names만, orgs 없음)이어야 한다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_meeting_name_sorts_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_meeting_name_sorts_check'
           and check_clause ~ 'parents' and check_clause ~ 'names' and check_clause !~ 'orgs') <> 1
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
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
    raise exception 'PROFILE_MEETING_NAME_ORGS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_meeting_name_sorts_check;
alter table public.app_profiles
  add constraint app_profiles_meeting_name_sorts_check check (
    case
      when jsonb_typeof(meeting_name_sorts) <> 'object' then false
      else
        octet_length(meeting_name_sorts::text) <= 32768
        -- 칸은 parents·names·orgs 셋뿐(S56-1에서 orgs 더함).
        and not jsonb_path_exists(meeting_name_sorts, 'strict $.keyvalue() ? (!(@.key == "parents" || @.key == "names" || @.key == "orgs"))')
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
        -- 정기 회의 조직(S56-1): 객체 300칸까지. 칸 이름 = 회의명 열쇠(names와 같은 규칙), 값 = 조직(상위) id 모양 글자.
        and case when not (meeting_name_sorts ? 'orgs') then true
              when jsonb_typeof(meeting_name_sorts -> 'orgs') <> 'object' then false
              when jsonb_array_length(jsonb_path_query_array(meeting_name_sorts, 'strict $.orgs.keyvalue().key')) > 300 then false
              else not jsonb_path_exists(meeting_name_sorts, 'strict $.orgs.keyvalue() ? (!(@.key like_regex "^[^[:cntrl:][:space:],]{1,100}$"))')
               and not jsonb_path_exists(meeting_name_sorts, 'strict $.orgs.* ? (@.type() != "string" || !(@ like_regex "^g[0-9a-z]{6,12}$"))') end
    end
  );

-- 사후 확인: 권한 경계 그대로, 저장된 orgs 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where meeting_name_sorts ? 'orgs') then
    raise exception 'PROFILE_MEETING_NAME_ORGS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110090000', 'profile_meeting_name_orgs', array['S56-1 MTG-org-groups: app_profiles_meeting_name_sorts_check recreated with orgs (up to 300 meeting name key -> org id), other rules unchanged; no grants/policies/functions/rows changed']);
commit;
