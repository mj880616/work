begin;
-- 20261028220000_photo_menu_index의 짝 되돌리기. 새 칸 13개(사진 12·폴더 1)·새 인덱스 2개·새 제약 5개를 지우고,
-- 화면 기억 검사를 photo_view 없이 열네 칸만 받는 20261028150000(diary_onedrive) 모양으로 되돌린 뒤 이번 기록 1행만 지운다.
-- 먼저 Edge onedrive-photos를 이 칸을 쓰지 않는 이전 판으로 되돌린다(새 판은 이 칸이 없으면 사진 목록을 못 읽는다).
-- 멈추는 경우(값을 지우거나 바꿔서 통과시키지 않는다. 어떻게 할지 명진이 정한 뒤 다시 계획한다):
--  ① 어떤 프로필이라도 photo_view가 저장돼 있으면 ② Web2 휴지통에 든 사진(trashed_at 있음)이 하나라도 있으면(되살릴 원래 폴더 기록이 사라진다).
-- 종류·크기·위치·해시 칸은 원드라이브에서 다시 받을 수 있는 목록 사본이라 지워도 자료 손실이 아니다.
-- 'Web2 휴지통' 폴더 자체는 켜짐=꺼짐으로 남아 일기·사진에 계속 보이지 않는다(role 칸만 사라짐). 표 권한·정책·함수·기존 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles, public.app_onedrive_folders, public.app_onedrive_photos in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028220000' and name = 'photo_menu_index') <> 1 then
    raise exception 'PHOTO_MENU_INDEX_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles where view_prefs -> 'photo_view' is not null) then
    raise exception 'PHOTO_MENU_INDEX_ROLLBACK_BLOCKED: photo view key saved; decide it first';
  end if;
  if exists (select 1 from public.app_onedrive_photos where trashed_at is not null) then
    raise exception 'PHOTO_MENU_INDEX_ROLLBACK_BLOCKED: photos in Web2 trash; restore or empty them first';
  end if;
end
$$;

drop index public.app_onedrive_folders_trash_uidx;
drop index public.app_onedrive_photos_recent_idx;
alter table public.app_onedrive_folders drop constraint app_onedrive_folders_role_check;
alter table public.app_onedrive_folders drop column role;
alter table public.app_onedrive_photos drop constraint app_onedrive_photos_media_check;
alter table public.app_onedrive_photos drop constraint app_onedrive_photos_sha1_check;
alter table public.app_onedrive_photos drop constraint app_onedrive_photos_location_check;
alter table public.app_onedrive_photos drop constraint app_onedrive_photos_trash_check;
alter table public.app_onedrive_photos
  drop column kind,
  drop column mime,
  drop column size_bytes,
  drop column width,
  drop column height,
  drop column duration_ms,
  drop column sha1,
  drop column lat,
  drop column lon,
  drop column screenshot,
  drop column trashed_at,
  drop column orig_parent_id;

alter table public.app_profiles drop constraint app_profiles_view_prefs_check;
alter table public.app_profiles
  add constraint app_profiles_view_prefs_check check (
    case
      when view_prefs is null then true
      when jsonb_typeof(view_prefs) <> 'object' then false
      else
        octet_length(view_prefs::text) <= 4000
        -- 칸은 아래 열네 개뿐(20261028150000 diary_onedrive 모양).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive"))')
        and case when not (view_prefs ? 'theme') then true
              else jsonb_typeof(view_prefs -> 'theme') = 'string' and view_prefs ->> 'theme' in ('olive', 'navy', 'ink', 'lavender', 'teal', 'sky', 'mint', 'coral', 'lemon', 'red') end
        and case when not (view_prefs ? 'nav_collapsed') then true
              else jsonb_typeof(view_prefs -> 'nav_collapsed') = 'boolean' end
        and case when not (view_prefs ? 'calendar_view') then true
              else jsonb_typeof(view_prefs -> 'calendar_view') = 'string' and view_prefs ->> 'calendar_view' in ('list', 'week', 'month') end
        and case when not (view_prefs ? 'home_quick_mode') then true
              else jsonb_typeof(view_prefs -> 'home_quick_mode') = 'string' and view_prefs ->> 'home_quick_mode' in ('update', 'task') end
        -- 노트 폴더: 전체·폴더 없음·폴더 이름(1~20자, 제어문자 없음).
        and case when not (view_prefs ? 'note_folder') then true
              when jsonb_typeof(view_prefs -> 'note_folder') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.note_folder ? (@ like_regex "^(all|none|f:[^[:cntrl:]]{1,20})$")') end
        -- 화면 분할 비율: 객체, 아는 화면 이름만, 값은 0 초과 1 미만 숫자.
        and case when not (view_prefs ? 'split_ratio') then true
              when jsonb_typeof(view_prefs -> 'split_ratio') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.split_ratio.keyvalue() ? (!(@.key == "tasks" || @.key == "projects" || @.key == "team" || @.key == "reports"))')
               and not jsonb_path_exists(view_prefs, 'strict $.split_ratio.* ? (@.type() != "number" || @ <= 0 || @ >= 1)') end
        -- 사업 보고 보기: 목록·달력·사진 셋 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'report_view') then true
              else jsonb_typeof(view_prefs -> 'report_view') = 'string' and view_prefs ->> 'report_view' in ('list', 'calendar', 'photo') end
        -- 수집 알림 숨김 날짜: YYYY-MM-DD 모양의 글자.
        and case when not (view_prefs ? 'collect_hidden_on') then true
              when jsonb_typeof(view_prefs -> 'collect_hidden_on') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.collect_hidden_on ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")') end
        -- 메뉴 편집: 객체, 칸은 bar(하단바)·rest(그 밖) 둘뿐이고 둘 다 글자 배열. 항목 이름은 소문자 영문·숫자·_·-(1~30자). 하단바 6개·그 밖 24개까지(목록 안의 이름 뜻은 화면이 맡는다).
        and case when not (view_prefs ? 'menu_layout') then true
              when jsonb_typeof(view_prefs -> 'menu_layout') <> 'object' then false
              when jsonb_typeof(view_prefs -> 'menu_layout' -> 'bar') is distinct from 'array'
                or jsonb_typeof(view_prefs -> 'menu_layout' -> 'rest') is distinct from 'array' then false
              else jsonb_array_length(view_prefs -> 'menu_layout' -> 'bar') <= 6
               and jsonb_array_length(view_prefs -> 'menu_layout' -> 'rest') <= 24
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.keyvalue() ? (!(@.key == "bar" || @.key == "rest"))')
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.bar[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.rest[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))') end
        -- 홈 칸: 보이는 칸의 이름을 순서대로 담은 글자 배열(같은 이름 규칙, 24개까지). 이 칸이 없으면 홈은 기본 칸 그대로.
        and case when not (view_prefs ? 'home_cards') then true
              when jsonb_typeof(view_prefs -> 'home_cards') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'home_cards') <= 24
               and not jsonb_path_exists(view_prefs, 'strict $.home_cards[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))') end
        -- 사진 격자 칸 수(OD-사진크기): 폰(좁은 화면)은 한 줄 2·3·4·6칸, PC(넓은 화면)는 6·8·10칸. 정수 숫자여야 한다.
        and case when not (view_prefs ? 'photo_cols') then true
              else jsonb_typeof(view_prefs -> 'photo_cols') = 'number' and view_prefs ->> 'photo_cols' in ('2', '3', '4', '6') end
        and case when not (view_prefs ? 'photo_cols_wide') then true
              else jsonb_typeof(view_prefs -> 'photo_cols_wide') = 'number' and view_prefs ->> 'photo_cols_wide' in ('6', '8', '10') end
        -- 일기 보기(JOURNAL-일기목록): 달력·목록 둘 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'diary_view') then true
              else jsonb_typeof(view_prefs -> 'diary_view') = 'string' and view_prefs ->> 'diary_view' in ('calendar', 'list') end
        -- 일기에서 원드라이브 사진 보이기(OD-연결아이콘): 참·거짓만(기본 켜짐은 화면이 정한다).
        and case when not (view_prefs ? 'diary_onedrive') then true
              else jsonb_typeof(view_prefs -> 'diary_onedrive') = 'boolean' end
    end
  );

delete from supabase_migrations.schema_migrations
  where version = '20261028220000' and name = 'photo_menu_index';
commit;
