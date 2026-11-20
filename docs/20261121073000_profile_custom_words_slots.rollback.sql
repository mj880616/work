begin;
-- 20261121073000_profile_custom_words_slots의 짝 되돌리기. 이름 바꾸기 검사를 affiliation·weekly 없는 20261120210000 profile_custom_words 모양(글자 그대로)으로 되돌리고
-- 이번 기록 1행만 지운다. 어떤 프로필이라도 두 칸 중 하나가 저장돼 있으면 멈춘다(값을 지워서 통과시키지 않는다 —
-- 먼저 화면 PR을 이전 판으로 되돌리고, 운영자 값은 docs/ops/custom-words-operator-slots.rollback.sql로 먼저 빼고, 남은 값을 어떻게 할지 정한 뒤 다시 계획한다).
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261121073000' and name = 'profile_custom_words_slots') <> 1 then
    raise exception 'PROFILE_CUSTOM_WORDS_SLOTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where custom_words ? 'affiliation' or custom_words ? 'weekly') then
    raise exception 'PROFILE_CUSTOM_WORDS_SLOTS_ROLLBACK_BLOCKED: new slot names saved; decide them first';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_custom_words_check;
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

delete from supabase_migrations.schema_migrations
  where version = '20261121073000' and name = 'profile_custom_words_slots';
commit;
