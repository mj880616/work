begin;
-- APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md, 2026-11-20 명진 결정 "기록+ 처음하는 사람은 메뉴 이름을 커스텀하게 해주고"):
-- 사람마다 메뉴·분류 이름을 고쳐 쓰는 설정을 내 프로필(app_profiles) 칸 하나에 둔다(서버 저장, 기기 저장 금지).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles.custom_words jsonb 칸 하나(비어 있음 = 고친 이름 없음 → 화면은 얼굴 기본 이름).
--   값 모양: {"칸 id": "이름", …} 객체. 칸 id는 아래 15개뿐(app/brand/custom-words-model.mjs SLOTS와 같다).
--   - 이름은 글자(문자열) 1~20자, 앞뒤 공백·제어문자 없음, < > & " ' ` \ 없음(화면 글자에 그대로 들어가므로 기호를 막는다).
--   - 전체 2000바이트까지. 기존 행은 비어 있는 채로 둔다(표를 다시 쓰지 않음). 기록 내용·사람 이름은 넣지 않는다(메뉴 이름만).
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수 없음. 화면은 기존 내 프로필 저장처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
--   기존 표 UPDATE 권한과 정책이 지금 모양일 때만 진행한다.
-- 짝: docs/20261120210000_profile_custom_words.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120210000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022163000' and name = 'profile_quick_links') <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'custom_words')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_custom_words_check')
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로(20261022163000 사전 확인과 같은 모양).
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_CUSTOM_WORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 고친 이름. 비어 있으면(null) 화면이 얼굴 기본 이름을 보여 준다.
alter table public.app_profiles
  add column custom_words jsonb;
alter table public.app_profiles
  add constraint app_profiles_custom_words_check check (
    custom_words is null or (
      jsonb_typeof(custom_words) = 'object'
      and octet_length(custom_words::text) <= 2000
      -- 칸 id는 15개뿐(메뉴·이름 7칸 + 활동 분류 8칸).
      and not jsonb_path_exists(custom_words, 'strict $.keyvalue() ? (!(@.key == "menu_biz" || @.key == "report" || @.key == "area" || @.key == "menu_org" || @.key == "org_one" || @.key == "org_report" || @.key == "workplace" || @.key == "kind_meeting" || @.key == "kind_policy" || @.key == "kind_negotiation" || @.key == "kind_press" || @.key == "kind_assembly" || @.key == "kind_struggle" || @.key == "kind_education" || @.key == "kind_other"))')
      -- 이름은 글자(문자열)여야 한다(숫자·null 등은 아래 정규식 검사를 빠져나가므로 먼저 막는다).
      and not jsonb_path_exists(custom_words, 'strict $.* ? (@.type() != "string")')
      -- 이름: 1~20자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(custom_words, 'lax $.* ? (!(@ like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,18}[^[:cntrl:][:space:]])?$"))')
      -- 기호 없음: 역빗금(글자 표현에서 " \ 제어문자는 모두 역빗금으로 적히므로 함께 막힌다)과 < > & ' `.
      and strpos(custom_words::text, chr(92)) = 0
      and custom_words::text !~ '[<>&''`]'
    )
  );

-- 사후 확인: 권한 경계 그대로, 모든 프로필의 새 칸은 비어 있음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles where custom_words is not null) then
    raise exception 'PROFILE_CUSTOM_WORDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261120210000', 'profile_custom_words', array['APP-기록+이름바꾸기: app_profiles.custom_words jsonb + CHECK (own profile via existing owner RLS, no grants/policies/functions)']);
commit;
