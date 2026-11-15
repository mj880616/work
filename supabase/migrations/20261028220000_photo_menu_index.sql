begin;
-- PHOTO-사진메뉴 서버 ① DB (설계 docs/design/photo-menu.md 2.2절 ①·③ 일부, 명진 결정 2026-10-28 22:43 1·6번).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 무엇:
--  1) app_onedrive_photos에 칸 12개: kind(photo·video, 기본 photo)·mime·size_bytes·width·height·duration_ms(동영상 길이)·sha1(같은 파일 찾기)
--     ·lat·lon(위치)·screenshot(스크린샷 여부, 기본 false)·trashed_at(Web2 휴지통으로 옮긴 시각)·orig_parent_id(옮기기 전 폴더 id, 되살리기용).
--     최신순 읽기용 인덱스 (workspace_id, taken_at desc, item_id desc) 1개.
--  2) app_onedrive_folders에 칸 1개: role(null 또는 'trash' = 'Web2 휴지통' 폴더, 결정 1). 작업공간마다 trash 하나뿐(부분 유일 인덱스).
--  3) app_profiles_view_prefs_check를 같은 이름으로 다시 만든다: 허용 칸 열네 개에 photo_view(사진 메뉴 거르기·칸 수, 결정 6)를 더해 열다섯 개.
--     photo_view = 객체 {filter: all|star|video|shot, cols: 정수 3~12}(둘 다 선택). 다른 칸 규칙(4000바이트 상한 포함)은 글자 그대로 같다.
-- 기존 행: 그대로 둔다. 새 칸은 null(kind='photo', screenshot=false)로 시작하고, Edge onedrive-photos 새 판이 다음 색인 때 채운다.
-- 권한: grant·revoke·정책·RLS·함수·트리거 변경 없음. 색인 표 두 개는 service_role이 이미 표 단위 select·insert·update·delete를 가져
--   새 칸도 그대로 쓸 수 있다(기존 표에 권한을 더하지 않는다). authenticated·anon은 여전히 아무것도 못 한다. app_profiles는 task12a owner 정책 그대로.
-- 앞 단계: 20261028010000_onedrive_photo_index와 20261028150000_profile_view_prefs_diary_onedrive 기록이 있어야 한다(없으면 멈춘다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles, public.app_onedrive_folders, public.app_onedrive_photos in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028220000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261028010000' and name = 'onedrive_photo_index') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261028150000' and name = 'profile_view_prefs_diary_onedrive') <> 1
     or exists (select 1 from pg_attribute where attrelid = 'public.app_onedrive_photos'::regclass and not attisdropped
         and attname in ('kind', 'mime', 'size_bytes', 'width', 'height', 'duration_ms', 'sha1', 'lat', 'lon', 'screenshot', 'trashed_at', 'orig_parent_id'))
     or exists (select 1 from pg_attribute where attrelid = 'public.app_onedrive_folders'::regclass and not attisdropped and attname = 'role')
     or to_regclass('public.app_onedrive_photos_recent_idx') is not null
     or to_regclass('public.app_onedrive_folders_trash_uidx') is not null
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'diary_onedrive' and check_clause !~ 'photo_view') <> 1
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_policy where polrelid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass))
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from pg_class where oid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])authenticated=')
     or (select count(*) from pg_class where oid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])service_role=arwd/') <> 2 then
    raise exception 'PHOTO_MENU_INDEX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_onedrive_photos
  add column kind text not null default 'photo',
  add column mime text,
  add column size_bytes bigint,
  add column width integer,
  add column height integer,
  add column duration_ms bigint,
  add column sha1 text,
  add column lat double precision,
  add column lon double precision,
  add column screenshot boolean not null default false,
  add column trashed_at timestamptz,
  add column orig_parent_id text,
  add constraint app_onedrive_photos_media_check check (
    kind in ('photo', 'video')
    and (mime is null or mime ~ '^(image|video)/[a-z0-9.+-]{1,80}$')
    and (size_bytes is null or size_bytes >= 0)
    and (width is null or width between 1 and 100000)
    and (height is null or height between 1 and 100000)
    and (duration_ms is null or duration_ms between 0 and 864000000)),
  add constraint app_onedrive_photos_sha1_check check (sha1 is null or sha1 ~ '^[0-9a-f]{40}$'),
  add constraint app_onedrive_photos_location_check check (
    (lat is null) = (lon is null)
    and (lat is null or (lat between -90 and 90 and lon between -180 and 180))),
  add constraint app_onedrive_photos_trash_check check (
    (orig_parent_id is null or orig_parent_id ~ '^[A-Za-z0-9!_.-]{1,200}$')
    and (orig_parent_id is null or trashed_at is not null));
create index app_onedrive_photos_recent_idx on public.app_onedrive_photos(workspace_id, taken_at desc, item_id desc);

alter table public.app_onedrive_folders
  add column role text,
  add constraint app_onedrive_folders_role_check check (role is null or role = 'trash');
create unique index app_onedrive_folders_trash_uidx on public.app_onedrive_folders(workspace_id) where role = 'trash';

alter table public.app_profiles drop constraint app_profiles_view_prefs_check;
alter table public.app_profiles
  add constraint app_profiles_view_prefs_check check (
    case
      when view_prefs is null then true
      when jsonb_typeof(view_prefs) <> 'object' then false
      else
        octet_length(view_prefs::text) <= 4000
        -- 칸은 아래 열다섯 개뿐(이번에 더하는 것은 photo_view 하나).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive" || @.key == "photo_view"))')
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
        -- 사진 메뉴 보기(PHOTO-사진메뉴, 결정 6: 칸 수를 일기와 따로): 객체, 칸은 filter·cols 둘뿐(둘 다 선택).
        -- filter = all·star·video·shot 중 하나(글자), cols = 한 줄 칸 수 정수 3~12(폰·PC 범위는 화면이 맡는다).
        and case when not (view_prefs ? 'photo_view') then true
              when jsonb_typeof(view_prefs -> 'photo_view') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_view.keyvalue() ? (!(@.key == "filter" || @.key == "cols"))')
               and (not (view_prefs -> 'photo_view' ? 'filter')
                 or (jsonb_typeof(view_prefs -> 'photo_view' -> 'filter') = 'string'
                   and view_prefs -> 'photo_view' ->> 'filter' in ('all', 'star', 'video', 'shot')))
               and (not (view_prefs -> 'photo_view' ? 'cols')
                 or (jsonb_typeof(view_prefs -> 'photo_view' -> 'cols') = 'number'
                   and view_prefs -> 'photo_view' ->> 'cols' in ('3', '4', '5', '6', '7', '8', '9', '10', '11', '12'))) end
    end
  );

-- 사후 확인: 권한 경계 그대로(세 표 RLS 켜짐, anon·PUBLIC 없음, 색인 표 정책 없음·authenticated 없음·service_role 넷 그대로, 프로필 정책 2개),
-- 새 칸·인덱스·제약이 있고 화면 기억 검사 1개가 검증된 상태에서 photo_view와 앞선 칸을 안다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and attacl is not null)
     or exists (select 1 from pg_policy where polrelid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass))
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from pg_class where oid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])authenticated=')
     or (select count(*) from pg_class where oid in ('public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass)
         and relacl::text ~ '(^|[{,])service_role=arwd/') <> 2
     or (select count(*) from pg_attribute where attrelid = 'public.app_onedrive_photos'::regclass and not attisdropped
         and attname in ('kind', 'mime', 'size_bytes', 'width', 'height', 'duration_ms', 'sha1', 'lat', 'lon', 'screenshot', 'trashed_at', 'orig_parent_id')) <> 12
     or (select count(*) from pg_attribute where attrelid = 'public.app_onedrive_folders'::regclass and not attisdropped and attname = 'role') <> 1
     or to_regclass('public.app_onedrive_photos_recent_idx') is null
     or to_regclass('public.app_onedrive_folders_trash_uidx') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'photo_view' and check_clause ~ 'diary_onedrive' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PHOTO_MENU_INDEX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028220000', 'photo_menu_index', array['PHOTO-사진메뉴 ①: app_onedrive_photos media/location/hash/trash columns + recent index, app_onedrive_folders role (trash), app_profiles_view_prefs_check also accepts photo_view (no grants, policies or functions)']);
commit;
