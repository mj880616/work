begin;
-- S67-57(내 프로필·가입·설정 화면의 노조 흔적 빼기, 2026-11-21 명진 "프로필 설정 화면도 노조 흔적 다 그대로인 거 맞지?"):
-- 사람별 이름 바꾸기(app_profiles.custom_words)에 칸 두 개를 더한다 — affiliation(소속 칸 이름: 기본 정보 '소속명'·'소속 묶음'),
-- weekly(주간 칸 이름: 내 프로필 '주간 정리 일정 캘린더'). WORK ON 기본은 노조 색 없는 이름, 명진은 자기 값(원래 글자)으로 지금 화면 그대로.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_custom_words_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 칸 id 열다섯 개(20261120210000 글자 그대로)에
--   affiliation·weekly를 더해 열일곱 개로. 이름 규칙(1~20자, 기호 없음)·2000바이트 상한은 글자 그대로 같다(넓히기만). 기존 행은 건드리지 않는다.
-- 권한: grant·revoke·정책·RLS·함수·트리거·새 열 변경 없음. 프로필 정책은 task12a 두 개 그대로.
-- 앞 단계: 20261120210000_profile_custom_words 기록이 있어야 한다(없으면 멈춘다).
-- 짝: docs/20261121073000_profile_custom_words_slots.{precheck,snapshot,postcheck,rollback}.sql, .summary.md. 명진 값 넣기: docs/ops/custom-words-operator-slots.*.sql
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261121073000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261120210000' and name = 'profile_custom_words') <> 1
     -- 이름 바꾸기 검사를 바꾼 판은 profile_custom_words가 마지막이어야 한다(그 위에 쌓음).
     or exists (select 1 from supabase_migrations.schema_migrations where version > '20261120210000' and name like 'profile_custom_words%')
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_custom_words_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_custom_words_check'
           and check_clause ~ 'menu_biz' and check_clause ~ 'workplace' and check_clause ~ 'kind_other' and check_clause ~ 'kind_education'
           and check_clause !~ 'affiliation' and check_clause !~ 'weekly') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'custom_words') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_CUSTOM_WORDS_SLOTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_custom_words_check;
alter table public.app_profiles
  add constraint app_profiles_custom_words_check check (
    custom_words is null or (
      jsonb_typeof(custom_words) = 'object'
      and octet_length(custom_words::text) <= 2000
      -- 칸 id는 열일곱 개뿐(메뉴·이름 7칸 + 활동 분류 8칸 + 소속·주간 2칸).
      and not jsonb_path_exists(custom_words, 'strict $.keyvalue() ? (!(@.key == "menu_biz" || @.key == "report" || @.key == "area" || @.key == "menu_org" || @.key == "org_one" || @.key == "org_report" || @.key == "workplace" || @.key == "kind_meeting" || @.key == "kind_policy" || @.key == "kind_negotiation" || @.key == "kind_press" || @.key == "kind_assembly" || @.key == "kind_struggle" || @.key == "kind_education" || @.key == "kind_other" || @.key == "affiliation" || @.key == "weekly"))')
      -- 이름은 글자(문자열)여야 한다(숫자·null 등은 아래 정규식 검사를 빠져나가므로 먼저 막는다).
      and not jsonb_path_exists(custom_words, 'strict $.* ? (@.type() != "string")')
      -- 이름: 1~20자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(custom_words, 'lax $.* ? (!(@ like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,18}[^[:cntrl:][:space:]])?$"))')
      -- 기호 없음: 역빗금(글자 표현에서 " \ 제어문자는 모두 역빗금으로 적히므로 함께 막힌다)과 < > & ' `.
      and strpos(custom_words::text, chr(92)) = 0
      and custom_words::text !~ '[<>&''`]'
    )
  );

-- 사후 확인: 권한 경계 그대로, 검사 하나(새 칸 포함). 다르면 전체 취소.
do $$
begin
  if (select count(*) from information_schema.check_constraints
      where constraint_schema = 'public' and constraint_name = 'app_profiles_custom_words_check'
        and check_clause ~ 'kind_other' and check_clause ~ 'affiliation' and check_clause ~ 'weekly') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_CUSTOM_WORDS_SLOTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261121073000', 'profile_custom_words_slots', array['S67-57: app_profiles_custom_words_check accepts affiliation and weekly slots (widen only; no grants/policies/functions/columns)']);
commit;
