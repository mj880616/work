begin;
-- 20261111100500_profile_meeting_name_presets의 짝 되돌리기. 회의명 정리 검사를 presets·order 없는 20261110090000 profile_meeting_name_orgs 모양(글자 그대로)으로
-- 되돌리고 이번 기록 1행만 지운다. 어떤 프로필이라도 presets(미리 넣은 회의명)나 order(정기 회의 줄 순서)가 저장돼 있으면 멈춘다(값을 지워서 통과시키지 않는다 —
-- 먼저 화면 PR을 이전 판으로 되돌리고, 남은 값을 어떻게 할지 정한 뒤 다시 계획한다). 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261111100500' and name = 'profile_meeting_name_presets') <> 1 then
    raise exception 'PROFILE_MEETING_NAME_PRESETS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where meeting_name_sorts ?| array['presets','order']) then
    raise exception 'PROFILE_MEETING_NAME_PRESETS_ROLLBACK_BLOCKED: presets or order saved; decide it first';
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

delete from supabase_migrations.schema_migrations
  where version = '20261111100500' and name = 'profile_meeting_name_presets';
commit;
