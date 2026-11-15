begin;
-- 20261028140000_library_view_group_order의 짝 되돌리기. 자료실 보기 검사를 group_order 없는 이전 모양(20261027173000: group_by·categories_off·recent_folders 셋)으로 되돌리고 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 group_order가 저장돼 있으면(화면에서 칩 순서를 바꾼 뒤) 멈춘다. 값을 지우거나 바꿔서 통과시키지 않는다.
-- 그런 경우 먼저 화면이 그 값을 더 쓰지 않게 되돌리고(칩 순서는 이 방문 동안만 유지) 저장된 값을 어떻게 할지 명진이 정한 뒤 다시 계획한다.
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028140000' and name = 'library_view_group_order') <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_ORDER_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where library_view ? 'group_order') then
    raise exception 'PROFILE_LIBRARY_VIEW_ORDER_ROLLBACK_BLOCKED: group order saved; decide it first';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_library_view_check;
alter table public.app_profiles
  add constraint app_profiles_library_view_check check (
    library_view is null or (
      jsonb_typeof(library_view) = 'object'
      and octet_length(library_view::text) <= 4000
      -- 칸은 group_by·categories_off·recent_folders 셋뿐.
      and not jsonb_path_exists(library_view, 'strict $.keyvalue() ? (!(@.key == "group_by" || @.key == "categories_off" || @.key == "recent_folders"))')
      -- 묶기: 프로젝트·담당조직·종류·월별·폴더 다섯 중 하나(글자여야 한다).
      and (not (library_view ? 'group_by') or (
        jsonb_typeof(library_view -> 'group_by') = 'string'
        and library_view ->> 'group_by' in ('project', 'organization', 'category', 'month', 'folder')
      ))
      -- 꺼 둔 종류: 배열 0~60개, 각 이름은 1~40자 글자(앞뒤 공백·제어문자 없음).
      and (not (library_view ? 'categories_off') or (
        jsonb_typeof(library_view -> 'categories_off') = 'array'
        and jsonb_array_length(library_view -> 'categories_off') <= 60
        and not jsonb_path_exists(library_view, 'strict $.categories_off[*] ? (@.type() != "string")')
        and not jsonb_path_exists(library_view, 'lax $.categories_off[*] ? (!(@ like_regex "^[^[:cntrl:][:space:]]([^[:cntrl:]]{0,38}[^[:cntrl:][:space:]])?$"))')
      ))
      -- 최근 넣은 폴더: 배열 0~5개, 모두 소문자 uuid 모양 글자(36자). 중복은 화면이 막고 DB 검사는 보지 않는다(검사식에는 하위 조회를 쓸 수 없고, 중복이 있어도 해롭지 않다).
      and (not (library_view ? 'recent_folders') or (
        jsonb_typeof(library_view -> 'recent_folders') = 'array'
        and jsonb_array_length(library_view -> 'recent_folders') <= 5
        and not jsonb_path_exists(library_view, 'strict $.recent_folders[*] ? (@.type() != "string")')
        and not jsonb_path_exists(library_view, 'lax $.recent_folders[*] ? (!(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')
      ))
    )
  );

delete from supabase_migrations.schema_migrations
  where version = '20261028140000' and name = 'library_view_group_order';
commit;
