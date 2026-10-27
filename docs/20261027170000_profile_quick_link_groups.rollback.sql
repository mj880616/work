begin;
-- 20261027170000_profile_quick_link_groups의 짝 되돌리기. 새 검사 둘과 새 칸 하나를 지우고 링크 검사를 원래 모양(group이 work·org 둘뿐)으로 되돌린 뒤 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 분류 목록을 저장해 두었으면(화면에서 분류를 고친 뒤) 멈춘다. 링크가 work·org 밖 분류에 있으면 아래에서 원래 링크 검사를 다시 만드는 순간
-- 그 행이 검사에 걸려 전체가 취소된다(링크를 지우거나 옮겨서 통과시키지 않는다). 사전 확인 SQL의 'custom link groups saved'가 0이어야 되돌릴 수 있다.
-- 그런 경우 먼저 목록을 캡처해 보관하고 복구 계획을 따로 세운다(화면은 칸이 없으면 분류 편집을 막고 지금 링크 목록을 읽을 수 있는 만큼 보여 준다).
-- 기존 표·정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261027170000' and name = 'profile_quick_link_groups') <> 1 then
    raise exception 'PROFILE_QUICK_LINK_GROUPS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where quick_link_groups is not null) then
    raise exception 'PROFILE_QUICK_LINK_GROUPS_ROLLBACK_BLOCKED: groups saved; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_quick_links_group_ref_check,
  drop constraint app_profiles_quick_links_check,
  drop constraint app_profiles_quick_link_groups_check,
  drop column quick_link_groups;
alter table public.app_profiles
  add constraint app_profiles_quick_links_check check (
    quick_links is null or (
      jsonb_typeof(quick_links) = 'array'
      and jsonb_array_length(quick_links) <= 60
      and octet_length(quick_links::text) <= 150000
      -- 항목은 객체이고 칸은 group·name·url 셋뿐.
      and not jsonb_path_exists(quick_links, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(quick_links, 'strict $[*].keyvalue() ? (!(@.key == "group" || @.key == "name" || @.key == "url"))')
      -- 묶음은 업무(work)·담당조직 홈페이지(org) 둘.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.group == "work" || @.group == "org"))')
      -- 이름·주소는 글자(문자열)여야 한다(숫자·null 등은 아래 정규식 검사를 빠져나가므로 먼저 막는다).
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.name.type() == "string" && @.url.type() == "string"))')
      -- 이름: 1~40자, 앞뒤 공백·제어문자 없음.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.name like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,38}[^[:cntrl:][:space:]])?$"))')
      -- 주소: http:// 또는 https://로 시작, 공백·제어문자 없음.
      and not jsonb_path_exists(quick_links, 'lax $[*] ? (!(@.url like_regex "^[hH][tT][tT][pP][sS]?://[^[:cntrl:][:space:]]+$"))')
    )
  );

delete from supabase_migrations.schema_migrations
  where version = '20261027170000' and name = 'profile_quick_link_groups';
commit;
