begin;
-- 20261027173000_library_view_recent_folders의 짝 되돌리기. 자료실 보기 검사를 recent_folders 없는 이전 모양(group_by·categories_off 둘, 묶기 다섯 값)으로 되돌리고 이번 기록 1행만 지운다.
-- 어떤 프로필이라도 recent_folders가 저장돼 있으면(화면에서 폴더로 옮긴 뒤) 멈춘다. 값을 지우거나 바꿔서 통과시키지 않는다.
-- 그런 경우 먼저 화면이 그 값을 더 쓰지 않게 되돌리고(최근 폴더는 이 방문 동안만 유지) 저장된 값을 어떻게 할지 명진이 정한 뒤 다시 계획한다.
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261027173000' and name = 'library_view_recent_folders') <> 1 then
    raise exception 'PROFILE_LIBRARY_VIEW_RECENT_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where library_view ? 'recent_folders') then
    raise exception 'PROFILE_LIBRARY_VIEW_RECENT_ROLLBACK_BLOCKED: recent folders saved; decide it first';
  end if;
end
$$;

alter table public.app_profiles drop constraint app_profiles_library_view_check;
alter table public.app_profiles
  add constraint app_profiles_library_view_check check (
    library_view is null or (
      jsonb_typeof(library_view) = 'object'
      and octet_length(library_view::text) <= 4000
      -- 칸은 group_by·categories_off 둘뿐.
      and not jsonb_path_exists(library_view, 'strict $.keyvalue() ? (!(@.key == "group_by" || @.key == "categories_off"))')
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
    )
  );

delete from supabase_migrations.schema_migrations
  where version = '20261027173000' and name = 'library_view_recent_folders';
commit;
