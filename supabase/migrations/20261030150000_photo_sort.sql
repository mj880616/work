begin;
-- PHOTO-정렬 1/2 DB (요청함 10/30 10:29, 명진 결정 '위 추천안대로'). 사진 화면(사진·폴더·앨범) 오른쪽 위 [정렬 ▾]로 고른 기준을
-- 서버에 하나로 기억하고(폰·PC 같음, 기기 저장 없음), '올린 날 최근 먼저'로 줄 세울 수 있게 원드라이브 올린 시각을 색인에 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇:
--  1) app_onedrive_photos에 칸 1개: uploaded_at timestamptz(null 허용) = 원드라이브 항목의 createdDateTime(올린 시각).
--     기존 행은 null로 시작하고 Edge onedrive-photos 새 판이 다음 색인 때 채운다(채워지기 전에는 화면이 찍은 시각으로 대신 줄 세운다).
--     인덱스는 더하지 않는다(찍은 날 밖의 기준은 Edge가 보이는 행을 읽어 줄 세운다).
--  2) app_profiles_view_prefs_check를 지우고 같은 이름으로 다시 만든다: photo_view 객체가 칸 sort를 더 받는다.
--     sort = taken_desc·taken_asc·uploaded_desc·name_asc·size_desc·duration_desc 중 하나(글자). 다른 칸·규칙(전체 4000바이트 상한 포함)은 글자 그대로 같다.
-- 기존 행: 그대로 둔다(프로필 값·사진 색인 값 바꾸지 않음).
-- 권한: grant·revoke·정책·RLS·함수·트리거 변경 없음. 색인 표는 service_role이 이미 표 단위 select·insert·update·delete를 가져
--   새 칸도 그대로 쓴다(기존 표에 권한을 더하지 않는다). authenticated·anon은 색인 표에 여전히 아무것도 못 한다. app_profiles는 task12a owner 정책 그대로.
-- 마이그레이션 본문의 확인은 승인형 workflow 엄격 규칙(do 블록 안 허용 함수 목록) 때문에 앞선 단계와 같이 information_schema로 읽는다.
--   짝 사전·사후 확인 파일은 pg_catalog(pg_constraint·pg_get_constraintdef 등)로만 읽는다(information_schema 안 씀).
-- 앞 단계: 20261028220000_photo_menu_index와 20261030091000_profile_view_prefs_note_boards 기록이 있어야 한다(없으면 멈춘다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles, public.app_onedrive_photos in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록 둘 있음, view_prefs 칸 있음, uploaded_at 칸 없음,
-- 검사 1개(검증됨, note_boards 있음, 아직 sort 값 없음), 두 표 RLS 켜짐, anon·PUBLIC 표 권한 없음, 색인 표 정책·authenticated 없음·service_role 넷,
-- 프로필 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030150000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261028220000' and name = 'photo_menu_index') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261030091000' and name = 'profile_view_prefs_note_boards') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'view_prefs') <> 1
     or exists (select 1 from pg_attribute where attrelid = 'public.app_onedrive_photos'::regclass and not attisdropped and attname = 'uploaded_at')
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'note_boards' and check_clause ~ 'photo_view' and check_clause !~ 'taken_desc') <> 1
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_photos'::regclass) and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_photos'::regclass) and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_policy where polrelid = 'public.app_onedrive_photos'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_onedrive_photos'::regclass and relacl::text ~ '(^|[{,])authenticated=')
     or (select count(*) from pg_class where oid = 'public.app_onedrive_photos'::regclass and relacl::text ~ '(^|[{,])service_role=arwd/') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PHOTO_SORT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_onedrive_photos
  add column uploaded_at timestamptz;

alter table public.app_profiles drop constraint app_profiles_view_prefs_check;
alter table public.app_profiles
  add constraint app_profiles_view_prefs_check check (
    case
      when view_prefs is null then true
      when jsonb_typeof(view_prefs) <> 'object' then false
      else
        octet_length(view_prefs::text) <= 4000
        -- 칸은 아래 열아홉 개뿐(20261030091000 note_boards와 같음. 이번에는 photo_view 안에 sort만 더함).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive" || @.key == "photo_view" || @.key == "quiet_weeks" || @.key == "note_view" || @.key == "note_boards" || @.key == "note_board"))')
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
        -- 화면 분할 비율: 객체, 아는 화면 이름만, 값은 0 초과 1 미만 숫자. 화면 이름 여덟 개(20261029010000).
        and case when not (view_prefs ? 'split_ratio') then true
              when jsonb_typeof(view_prefs -> 'split_ratio') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.split_ratio.keyvalue() ? (!(@.key == "tasks" || @.key == "projects" || @.key == "team" || @.key == "reports" || @.key == "telegram" || @.key == "calls" || @.key == "refs" || @.key == "reports3"))')
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
        -- 사진 메뉴 보기(PHOTO-사진메뉴 결정 6 + PHOTO-정렬): 객체, 칸은 filter·cols·sort 셋뿐(셋 다 선택).
        -- filter = all·star·video·shot 중 하나(글자), cols = 한 줄 칸 수 정수 3~12(폰·PC 범위는 화면이 맡는다).
        -- sort = 사진 정렬 기준(글자): 찍은 날 최근·오래된 먼저, 올린 날 최근 먼저, 파일 이름 가나다, 크기 큰 것, 동영상 길이 긴 것 먼저.
        and case when not (view_prefs ? 'photo_view') then true
              when jsonb_typeof(view_prefs -> 'photo_view') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_view.keyvalue() ? (!(@.key == "filter" || @.key == "cols" || @.key == "sort"))')
               and (not (view_prefs -> 'photo_view' ? 'filter')
                 or (jsonb_typeof(view_prefs -> 'photo_view' -> 'filter') = 'string'
                   and view_prefs -> 'photo_view' ->> 'filter' in ('all', 'star', 'video', 'shot')))
               and (not (view_prefs -> 'photo_view' ? 'cols')
                 or (jsonb_typeof(view_prefs -> 'photo_view' -> 'cols') = 'number'
                   and view_prefs -> 'photo_view' ->> 'cols' in ('3', '4', '5', '6', '7', '8', '9', '10', '11', '12')))
               and (not (view_prefs -> 'photo_view' ? 'sort')
                 or (jsonb_typeof(view_prefs -> 'photo_view' -> 'sort') = 'string'
                   and view_prefs -> 'photo_view' ->> 'sort' in ('taken_desc', 'taken_asc', 'uploaded_desc', 'name_asc', 'size_desc', 'duration_desc'))) end
        -- 연락 없는 조직 기준(FEAT-1029묶음 ③): 정수 0(끔) 또는 1~12(주). 숫자여야 한다.
        and case when not (view_prefs ? 'quiet_weeks') then true
              else jsonb_typeof(view_prefs -> 'quiet_weeks') = 'number' and view_prefs ->> 'quiet_weeks' in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12') end
        -- 노트 보기(NOTE-보기3가지): 폴더·목록·포스트잇 셋 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'note_view') then true
              else jsonb_typeof(view_prefs -> 'note_view') = 'string' and view_prefs ->> 'note_view' in ('folder', 'list', 'board') end
        -- 노트 보드 목록(NOTE-보드여러개): 배열 12개까지, 칸마다 객체 {id, name} 둘뿐(순서 = 보드 칸 순서).
        -- id = 'b' + 소문자 영문·숫자 6~12자, name = 1~20자(제어문자 없음). 같은 id 겹침·앞뒤 빈칸은 화면이 막는다.
        and case when not (view_prefs ? 'note_boards') then true
              when jsonb_typeof(view_prefs -> 'note_boards') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'note_boards') > 12 then false
              when jsonb_path_exists(view_prefs, 'strict $.note_boards[*] ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.note_boards[*].keyvalue() ? (!(@.key == "id" || @.key == "name"))')
               and jsonb_array_length(jsonb_path_query_array(view_prefs, 'lax $.note_boards[*] ? (@.id.type() == "string" && @.id like_regex "^b[0-9a-z]{6,12}$" && @.name.type() == "string" && @.name like_regex "^[^[:cntrl:]]{1,20}$")'))
                   = jsonb_array_length(view_prefs -> 'note_boards') end
        -- 마지막에 연 보드: 'all'(전체) 또는 보드 id 모양 글자.
        and case when not (view_prefs ? 'note_board') then true
              when jsonb_typeof(view_prefs -> 'note_board') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.note_board ? (@ like_regex "^(all|b[0-9a-z]{6,12})$")') end
    end
  );

-- 사후 확인: 권한 경계 그대로(두 표 RLS 켜짐, anon·PUBLIC 없음, 색인 표 정책·authenticated·칸 권한 없음·service_role 넷 그대로, 프로필 정책 2개),
-- 새 칸이 있고 검사 1개가 검증된 상태에서 sort 값과 앞선 칸을 안다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_photos'::regclass) and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_profiles'::regclass, 'public.app_onedrive_photos'::regclass) and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_onedrive_photos'::regclass and attacl is not null)
     or exists (select 1 from pg_policy where polrelid = 'public.app_onedrive_photos'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_onedrive_photos'::regclass and relacl::text ~ '(^|[{,])authenticated=')
     or (select count(*) from pg_class where oid = 'public.app_onedrive_photos'::regclass and relacl::text ~ '(^|[{,])service_role=arwd/') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_attribute where attrelid = 'public.app_onedrive_photos'::regclass and not attisdropped and attname = 'uploaded_at'
         and atttypid = 'timestamptz'::regtype and not attnotnull) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'taken_desc' and check_clause ~ 'duration_desc' and check_clause ~ 'note_boards' and check_clause ~ 'photo_view'
           and check_clause ~ 'quiet_weeks' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PHOTO_SORT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030150000', 'photo_sort', array['PHOTO-정렬: app_onedrive_photos.uploaded_at (OneDrive createdDateTime, nullable) + app_profiles_view_prefs_check photo_view also accepts sort (taken_desc|taken_asc|uploaded_desc|name_asc|size_desc|duration_desc); no grants, policies, indexes or functions']);
commit;
