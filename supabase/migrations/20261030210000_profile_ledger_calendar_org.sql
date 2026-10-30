begin;
-- CAL-조직참고캘린더 1/2 DB (요청함 10/30 16:03, 명진 결정 "별도 범용 기능 없이 그 캘린더 하나만, 그 조직 주간보고 때 참고해서 제안").
-- 내 프로필 '참고 일정' 칸을 '조직 참고 캘린더' 한 줄로 바꾼다: 구독한 캘린더 하나 + 그 캘린더가 어느 담당조직 것인지(조직 id).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_ledger_calendar_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 받는 키 셋(calendar·colors·mine)에 org 하나를 더한다.
--   org = 담당조직 id(소문자 uuid 글자). 없어도 된다(고르지 않음). 다른 키 규칙(전체 2048바이트 상한 포함)은 글자 그대로 같다.
--   colors·mine은 화면이 더 쓰지 않지만 이미 저장된 값이 있을 수 있어 그대로 받는다(기존 행을 건드리지 않음).
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 열 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   org 값은 화면 추천 칸을 고르는 데만 쓰고 권한 판단에 쓰지 않는다(다른 작업공간 조직 id를 적어도 아무것도 열리지 않는다).
-- 마이그레이션 본문의 확인은 승인형 workflow 엄격 규칙(do 블록 안 허용 함수 목록) 때문에 앞선 단계와 같이 information_schema로 읽는다.
--   짝 사전·사후 확인 파일은 pg_constraint·pg_get_constraintdef로만 읽는다(information_schema 안 씀).
-- 앞 단계: 20261025110000_ledger_sources 기록이 있어야 한다(없으면 멈춘다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(ledger_sources) 있음, ledger_calendar 칸 있음,
-- 검사 1개(검증됨, mine 있음, 아직 org 없음), RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030210000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261025110000' and name = 'ledger_sources') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'ledger_calendar') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_ledger_calendar_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_ledger_calendar_check'
           and check_clause ~ 'mine' and check_clause ~ 'colors' and check_clause !~ '"org"') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_LEDGER_CALENDAR_ORG_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_ledger_calendar_check;
alter table public.app_profiles
  add constraint app_profiles_ledger_calendar_check check (
    case
      when jsonb_typeof(ledger_calendar) <> 'object' then false
      else
        octet_length(ledger_calendar::text) <= 2048
        -- 키는 아래 넷뿐(20261025110000 ledger_sources의 셋 + org).
        and not jsonb_path_exists(ledger_calendar, 'strict $.keyvalue() ? (!(@.key == "calendar" || @.key == "colors" || @.key == "mine" || @.key == "org"))')
        and case when not (ledger_calendar ? 'calendar') then true
              when jsonb_typeof(ledger_calendar -> 'calendar') <> 'string' then false
              else char_length(ledger_calendar ->> 'calendar') between 1 and 200 and (ledger_calendar ->> 'calendar') !~ '[[:cntrl:]]' end
        and case when not (ledger_calendar ? 'colors') then true
              when jsonb_typeof(ledger_calendar -> 'colors') <> 'array' then false
              else jsonb_array_length(ledger_calendar -> 'colors') <= 5
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (@.type() != "string")')
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (!(@ like_regex "^[0-9]{1,2}$"))') end
        and case when not (ledger_calendar ? 'mine') then true
              else jsonb_typeof(ledger_calendar -> 'mine') = 'boolean' end
        -- 담당조직 id: 소문자 uuid 글자(36자).
        and case when not (ledger_calendar ? 'org') then true
              when jsonb_typeof(ledger_calendar -> 'org') <> 'string' then false
              else (ledger_calendar ->> 'org') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end
    end
  );

-- 사후 확인: 어긋나면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_ledger_calendar_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_ledger_calendar_check'
           and check_clause ~ '"org"' and check_clause ~ 'mine' and check_clause ~ 'colors' and check_clause ~ '2048') <> 1 then
    raise exception 'PROFILE_LEDGER_CALENDAR_ORG_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030210000', 'profile_ledger_calendar_org', array['CAL-조직참고캘린더: app_profiles_ledger_calendar_check also accepts org (lowercase uuid text, the organization the reference calendar belongs to); no new column, grants, policies or functions']);
commit;
