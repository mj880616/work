begin;
-- BIZ-주간보고접힘기억(S56-13, 요청함 11/10 10:00 "이번주 주간보고, 어느페이지에서든 펼침, 접힘 기억" → "기기별로 기억"):
-- 사업 보고 위 '이번 주 주간보고' 칸을 손으로 접고 편 상태를 기기 종류별로 서버에 기억한다(기기 저장 금지 — box_shut과 같은 방식).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_view_prefs_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 받는 칸 쉰세 개(20261109193000 profile_view_prefs_library_two 판 글자 그대로)에
--   biz_week_open 하나를 더해 쉰네 개로. biz_week_open = {app?, phone?, pc?: 참·거짓}. 보고 내용·주 날짜는 넣지 않는다.
--   다른 칸 규칙·전체 4000바이트 상한은 글자 그대로 같다(넓히기만). 기존 행은 건드리지 않는다.
-- 권한: grant·revoke·정책·RLS·함수·트리거·새 열 변경 없음. 프로필 정책은 task12a 두 개 그대로.
-- 앞 단계: 20261109193000_profile_view_prefs_library_two(LIB-두칸보기) 기록이 있어야 한다(없으면 멈춘다). 이 검사는 그 단계의 library_two까지 그대로 담고 있다.
-- 짝: docs/20261110170000_profile_view_prefs_biz_week_open.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110170000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261109193000' and name = 'profile_view_prefs_library_two') <> 1
     -- 화면 기억 검사를 바꾼 판은 profile_view_prefs_library_two가 마지막이어야 한다(그 위에 쌓음).
     or exists (select 1 from supabase_migrations.schema_migrations where version > '20261109193000' and name like 'profile_view_prefs%')
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'library_two' and check_clause ~ 'org_row_order' and check_clause ~ 'recent_folded' and check_clause ~ 'files_look' and check_clause ~ 'news_font' and check_clause ~ 'news_tab' and check_clause ~ 'org_order' and check_clause ~ 'photo_zoom' and check_clause ~ 'files_panes' and check_clause ~ 'box_shut' and check_clause ~ 'files_tree' and check_clause ~ 'files_pins' and check_clause ~ 'files_last' and check_clause ~ 'category_roles' and check_clause !~ 'biz_week_open') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'view_prefs') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_BIZ_WEEK_OPEN_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;


alter table public.app_profiles drop constraint app_profiles_view_prefs_check;
alter table public.app_profiles
  add constraint app_profiles_view_prefs_check check (
    case
      when view_prefs is null then true
      when jsonb_typeof(view_prefs) <> 'object' then false
      else
        octet_length(view_prefs::text) <= 4000
        -- 칸은 아래 쉰네 개뿐(20261109193000의 쉰세 개 + biz_week_open).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive" || @.key == "photo_view" || @.key == "quiet_weeks" || @.key == "note_view" || @.key == "note_boards" || @.key == "note_board" || @.key == "photo_hint" || @.key == "photo_sources" || @.key == "org_tab" || @.key == "tg_view" || @.key == "phone_folders_off" || @.key == "album_view" || @.key == "now_tab" || @.key == "link_hidden_on" || @.key == "ed_more" || @.key == "phone_folders_known" || @.key == "col_widths" || @.key == "photo_sources_phone" || @.key == "photo_sources_pc" || @.key == "photo_level" || @.key == "report_period" || @.key == "files_sources" || @.key == "files_dest_recent" || @.key == "files_two" || @.key == "note_sort" || @.key == "photo_zoom" || @.key == "org_order" || @.key == "report_calendar" || @.key == "news_tab" || @.key == "news_font" || @.key == "files_look" || @.key == "recent_folded" || @.key == "files_panes" || @.key == "box_shut" || @.key == "files_tree" || @.key == "files_pins" || @.key == "files_last" || @.key == "category_roles" || @.key == "org_row_order" || @.key == "library_two" || @.key == "biz_week_open"))')
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
        -- 화면 분할 비율: 객체, 아는 화면 이름만, 값은 0 초과 1 미만 숫자. 화면 이름 열네 개(20261029010000의 여덟 + 20261031030000 사진 폴더·아스날·노트 폴더·노트 보드 + Now 두 칸 + 파일 files).
        and case when not (view_prefs ? 'split_ratio') then true
              when jsonb_typeof(view_prefs -> 'split_ratio') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.split_ratio.keyvalue() ? (!(@.key == "tasks" || @.key == "projects" || @.key == "team" || @.key == "reports" || @.key == "telegram" || @.key == "calls" || @.key == "refs" || @.key == "reports3" || @.key == "photos" || @.key == "arsenal" || @.key == "notes" || @.key == "noteboard" || @.key == "now" || @.key == "files" || @.key == "library"))')
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
        -- 크게 보기 손동작 안내를 본 횟수(PHOTO-스와이프안내): 정수 0~9. 숫자여야 한다(몇 번까지 보일지는 화면이 정한다).
        and case when not (view_prefs ? 'photo_hint') then true
              else jsonb_typeof(view_prefs -> 'photo_hint') = 'number' and view_prefs ->> 'photo_hint' in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9') end
        -- 사진 출처 켜기/끄기(PHOTO-출처): 객체, 칸은 onedrive(원드라이브)·gdrive(구글 드라이브)·phone(폰 사진) 셋뿐이고 값은 모두 참·거짓.
        -- 없는 칸은 화면이 기본(원드라이브 켜짐, 나머지 꺼짐)으로 본다.
        and case when not (view_prefs ? 'photo_sources') then true
              when jsonb_typeof(view_prefs -> 'photo_sources') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources.* ? (@.type() != "boolean")') end
        -- 담당조직 상세 소탭(DESK-현황표): 기록·현황 표 둘 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'org_tab') then true
              else jsonb_typeof(view_prefs -> 'org_tab') = 'string' and view_prefs ->> 'org_tab' in ('log', 'table') end
        -- 텔레그램 소식 보기(TG-방별보기): 날짜별·방별 둘 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'tg_view') then true
              else jsonb_typeof(view_prefs -> 'tg_view') = 'string' and view_prefs ->> 'tg_view' in ('day', 'room') end
        -- 끈 폰 폴더(PHOTO-폴더스위치): 글자 배열 80개까지, 칸마다 0~255자(제어문자 없음, 빈 글자 = 사진첩 맨 위). 없으면 모든 폰 폴더가 켜짐.
        and case when not (view_prefs ? 'phone_folders_off') then true
              when jsonb_typeof(view_prefs -> 'phone_folders_off') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'phone_folders_off') <= 80
               and not jsonb_path_exists(view_prefs, 'strict $.phone_folders_off[*] ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{0,255}$"))') end
        -- 사진 앨범 보기(PHOTO-위쪽두줄앨범보기): 큰 칸·작은 그림 목록·한 줄 목록 셋 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'album_view') then true
              else jsonb_typeof(view_prefs -> 'album_view') = 'string' and view_prefs ->> 'album_view' in ('card', 'thumb', 'line') end
        -- Now 메뉴 마지막 탭(OUTSIDE-글상세·Now 합치기): 사회운동·뉴스·보관·문장 찾기 넷 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'now_tab') then true
              else jsonb_typeof(view_prefs -> 'now_tab') = 'string' and view_prefs ->> 'now_tab' in ('outside', 'news', 'saved', 'search') end
        -- 연결 끊김 알림 숨김 날짜(UI-앱안알림, 맨 위 알림 줄 ✕ = 오늘 하루 숨김): collect_hidden_on과 같은 YYYY-MM-DD 모양의 글자.
        and case when not (view_prefs ? 'link_hidden_on') then true
              when jsonb_typeof(view_prefs -> 'link_hidden_on') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.link_hidden_on ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")') end
        -- 편집기 서식 줄 [⌄] 아래 줄 펼침(S48-21): 참·거짓만(없으면 접힘은 화면이 정한다).
        and case when not (view_prefs ? 'ed_more') then true
              else jsonb_typeof(view_prefs -> 'ed_more') = 'boolean' end
        -- 아는 폰 폴더(S48-31, 새 폰 폴더는 꺼진 채): 글자 배열 120개까지, 칸마다 폴더 경로의 짧은 지문(소문자 16진수 8자). 경로 원문은 담지 않는다.
        -- 없으면 화면이 처음 한 번 지금 보이는 폰 폴더를 모두 넣는다(보이는 상태 그대로). 여기 없고 끈 목록에도 없는 폴더 = 새 폴더 → 끈 목록에 더함.
        and case when not (view_prefs ? 'phone_folders_known') then true
              when jsonb_typeof(view_prefs -> 'phone_folders_known') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'phone_folders_known') <= 120
               and not jsonb_path_exists(view_prefs, 'strict $.phone_folders_known[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-f]{8}$"))') end
        -- 표 칸 폭(S49-4 FILES-칸폭): 객체(화면 이름 12개까지), 화면 이름·칸 이름은 소문자 영문으로 시작하는 소문자 영문·숫자·_ 1~20자,
        -- 화면마다 객체이고 칸 값은 40 이상 800 이하 숫자(px). 없으면 화면 기본 폭.
        and case when not (view_prefs ? 'col_widths') then true
              when jsonb_typeof(view_prefs -> 'col_widths') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.col_widths.* ? (@.type() != "object")') then false
              else jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.col_widths.keyvalue().key')) <= 12
               and not jsonb_path_exists(view_prefs, 'strict $.col_widths.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,19}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.col_widths.*.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,19}$") || @.value.type() != "number" || @.value < 40 || @.value > 800)') end
        -- 사진 출처 켜기·끄기를 폰과 PC가 따로 기억(PHOTO-기기별출처): photo_sources_phone·photo_sources_pc = {onedrive, gdrive, phone} 중 일부, 값은 참·거짓(photo_sources와 같은 모양).
        and case when not (view_prefs ? 'photo_sources_phone') then true
              when jsonb_typeof(view_prefs -> 'photo_sources_phone') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources_phone.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources_phone.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'photo_sources_pc') then true
              when jsonb_typeof(view_prefs -> 'photo_sources_pc') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources_pc.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources_pc.* ? (@.type() != "boolean")') end
        -- 사진 보기 단계(PHOTO-연월이동 B): 연·월·일 셋 중 하나(글자여야 한다). 없으면 일.
        and case when not (view_prefs ? 'photo_level') then true
              else jsonb_typeof(view_prefs -> 'photo_level') = 'string' and view_prefs ->> 'photo_level' in ('year', 'month', 'day') end
        -- 사업 보고 기간 보기(S49-11 REPORT-기간고르기): 객체, 칸은 mode·from·to 셋뿐. mode = all(전체)·week(주간 보기)·range(기간 설정) 중 하나(글자).
        -- range일 때만 from·to가 있고 둘 다 YYYY-MM-DD 글자이며 from이 to보다 늦지 않다. all·week일 때는 from·to가 없다. 어느 주인지는 저장하지 않는다(늘 이번 주부터).
        and case when not (view_prefs ? 'report_period') then true
              when jsonb_typeof(view_prefs -> 'report_period') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.report_period.keyvalue() ? (!(@.key == "mode" || @.key == "from" || @.key == "to"))')
               and jsonb_typeof(view_prefs -> 'report_period' -> 'mode') is not distinct from 'string'
               and view_prefs -> 'report_period' ->> 'mode' in ('all', 'week', 'range')
               and case when view_prefs -> 'report_period' ->> 'mode' = 'range'
                     then jsonb_typeof(view_prefs -> 'report_period' -> 'from') is not distinct from 'string'
                      and jsonb_typeof(view_prefs -> 'report_period' -> 'to') is not distinct from 'string'
                      and coalesce(view_prefs -> 'report_period' ->> 'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
                      and coalesce(view_prefs -> 'report_period' ->> 'to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
                      and (view_prefs -> 'report_period' ->> 'from') <= (view_prefs -> 'report_period' ->> 'to')
                     else not (view_prefs -> 'report_period' ? 'from') and not (view_prefs -> 'report_period' ? 'to') end end
        -- [파일] 출처 켜기·끄기(S49-21 FILES-출처켜고끄기, S49-26 기기마다 따로): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐이고
        -- 각 칸은 객체, 그 안 칸은 od(원드라이브)·gd(구글 드라이브) 둘뿐이며 값은 모두 참·거짓. 없는 칸은 화면이 기본(둘 다 켜짐)으로 본다.
        -- 기기 칸이 객체인지 먼저 따진 뒤(case 순서) 안쪽 칸을 본다(strict 경로가 객체 아닌 값에서 오류를 내지 않게).
        and case when not (view_prefs ? 'files_sources') then true
              when jsonb_typeof(view_prefs -> 'files_sources') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_sources.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_sources.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_sources.*.keyvalue() ? (!(@.key == "od" || @.key == "gd"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_sources.*.* ? (@.type() != "boolean")') end
        -- [파일] 최근 보낸 곳(S49-27 FILES-통합 2-①, 받을 곳 창 위 칩): 배열 3개까지, 칸마다 객체 {source, id, name} 셋뿐(셋 다 있어야 함).
        -- source = od(원드라이브)·gd(구글 드라이브), id = 폴더 id 글자 0~120자(영문·숫자·! _ . -, 빈 글자 = 맨 위), name = 칩에 보일 이름 1~40자(제어문자 없음).
        and case when not (view_prefs ? 'files_dest_recent') then true
              when jsonb_typeof(view_prefs -> 'files_dest_recent') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'files_dest_recent') > 3 then false
              when jsonb_path_exists(view_prefs, 'strict $.files_dest_recent[*] ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_dest_recent[*].keyvalue() ? (!(@.key == "source" || @.key == "id" || @.key == "name"))')
               and jsonb_array_length(jsonb_path_query_array(view_prefs, 'lax $.files_dest_recent[*] ? (@.source.type() == "string" && (@.source == "od" || @.source == "gd") && @.id.type() == "string" && @.id like_regex "^[A-Za-z0-9!_.-]{0,120}$" && @.name.type() == "string" && @.name like_regex "^[^[:cntrl:]]{1,40}$")'))
                   = jsonb_array_length(view_prefs -> 'files_dest_recent') end
        -- [파일] 두 칸 켬(S49-30 FILES-통합 2-③, 명진 결정 H-2): 객체, 칸은 기기 종류 app·phone·pc 셋뿐(files_sources와 같은 모양)이고
        -- 각 칸은 객체, 그 안 칸은 fold(폴드 펼침)·wide(PC)·narrow(폰 한 칸 600px 미만, S51-20 ② 폰 위·아래 두 칸에서 더함) 셋뿐이며 값은 모두 참·거짓. 없는 칸은 화면이 기본(폴드 = 두 칸, PC = 한 칸)으로 본다.
        and case when not (view_prefs ? 'files_two') then true
              when jsonb_typeof(view_prefs -> 'files_two') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_two.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_two.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_two.*.keyvalue() ? (!(@.key == "fold" || @.key == "wide" || @.key == "narrow"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_two.*.* ? (@.type() != "boolean")') end
        -- 노트 목록 정렬(S49-38 FOLDER-순서·색 ②): changed(고친 날, 기본) 또는 manual(내가 정한 순서) 둘 중 하나(글자여야 한다). 없으면 화면이 changed로 본다.
        and case when not (view_prefs ? 'note_sort') then true
              else jsonb_typeof(view_prefs -> 'note_sort') = 'string' and view_prefs ->> 'note_sort' in ('changed', 'manual') end
        -- 사진 [사진] 탭 보기 단계(S49-48 PHOTO-연월보기): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐, 값은 year·month·day 중 하나(글자). 없으면 화면이 day로 본다.
        and case when not (view_prefs ? 'photo_zoom') then true
              when jsonb_typeof(view_prefs -> 'photo_zoom') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_zoom.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_zoom.* ? (@.type() != "string" || !(@ == "year" || @ == "month" || @ == "day"))') end
        -- 담당조직 묶음·순서(S50-13 MULTI ②-3, D5): 객체, 칸은 groups·hidden 둘 다 있어야 하고 둘 다 배열.
        -- groups = 12개까지, 칸마다 객체 {name, orgs} 둘뿐: name = 묶음 이름 1~20자(제어문자 없음), orgs = 조직 이름(1~60자, 제어문자 없음) 1~40개.
        -- hidden = 고르기에서 뺄 조직 이름(같은 모양) 40개까지. 모양을 차례로 따진 뒤(case 순서) 안쪽을 본다(strict 경로가 오류를 내지 않게).
        and case when not (view_prefs ? 'org_order') then true
              when jsonb_typeof(view_prefs -> 'org_order') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.org_order.keyvalue() ? (!(@.key == "groups" || @.key == "hidden"))') then false
              when jsonb_typeof(view_prefs -> 'org_order' -> 'groups') is distinct from 'array'
                or jsonb_typeof(view_prefs -> 'org_order' -> 'hidden') is distinct from 'array' then false
              when jsonb_array_length(view_prefs -> 'org_order' -> 'groups') > 12
                or jsonb_array_length(view_prefs -> 'org_order' -> 'hidden') > 40 then false
              when jsonb_path_exists(view_prefs, 'strict $.org_order.hidden[*] ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{1,60}$"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.org_order.groups[*] ? (@.type() != "object")') then false
              when jsonb_path_exists(view_prefs, 'strict $.org_order.groups[*].keyvalue() ? (!(@.key == "name" || @.key == "orgs"))') then false
              when jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.org_order.groups[*] ? (exists(@.name) && exists(@.orgs))'))
                   <> jsonb_array_length(view_prefs -> 'org_order' -> 'groups') then false
              when jsonb_path_exists(view_prefs, 'strict $.org_order.groups[*] ? (@.name.type() != "string" || !(@.name like_regex "^[^[:cntrl:]]{1,20}$") || @.orgs.type() != "array" || @.orgs.size() < 1 || @.orgs.size() > 40)') then false
              else not jsonb_path_exists(view_prefs, 'strict $.org_order.groups[*].orgs[*] ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{1,60}$"))') end
        -- 보고 캘린더 이름(S50-13 MULTI ②-3, D5): 글자 1~60자(제어문자 없음). 없으면 화면이 '보고 캘린더 미지정'을 알린다.
        and case when not (view_prefs ? 'report_calendar') then true
              when jsonb_typeof(view_prefs -> 'report_calendar') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.report_calendar ? (@ like_regex "^[^[:cntrl:]]{1,60}$")') end
        -- News 메뉴 마지막 탭(S51-6 NEWS-전면개편 P4a): 전체·사회운동·언론·보관 넷 중 하나(글자여야 한다). 옛 now_tab은 그대로 둔다(P5에서 옮김).
        and case when not (view_prefs ? 'news_tab') then true
              else jsonb_typeof(view_prefs -> 'news_tab') = 'string' and view_prefs ->> 'news_tab' in ('all', 'movement', 'media', 'archive') end
        -- News 글 상세 글자 크기(S51-6 NEWS-전면개편 P4a): 작게·보통·크게(s·m·l) 셋 중 하나(글자여야 한다).
        and case when not (view_prefs ? 'news_font') then true
              else jsonb_typeof(view_prefs -> 'news_font') = 'string' and view_prefs ->> 'news_font' in ('s', 'm', 'l') end
        -- [파일] 목록 보기 크기(S51-20 FILES-폰보기끌기 ①): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐(files_two와 같은 모양)이고
        -- 각 칸은 객체, 그 안 칸은 화면 폭 종류 narrow(폰 한 칸 600px 미만)·fold(폴드 펼침 600~1199)·wide(PC 1200~) 셋뿐이며
        -- 값은 list(목록)·grid(격자)·big(큰 격자) 중 하나(글자). 없는 칸은 화면이 list로 본다. 한 줄 칸 수는 화면 폭이 정한다(저장하지 않음).
        and case when not (view_prefs ? 'files_look') then true
              when jsonb_typeof(view_prefs -> 'files_look') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_look.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_look.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_look.*.keyvalue() ? (!(@.key == "narrow" || @.key == "fold" || @.key == "wide"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_look.*.* ? (@.type() != "string" || !(@ == "list" || @ == "grid" || @ == "big"))') end
        -- '최근' 상자 접기(S51-22, 요청함 11/06 19:50): 접은 화면 이름 배열. 화면 이름은 files(파일)·notes(노트)·library(자료실) 셋뿐, 4개까지. 없으면 모두 펼침.
        and case when not (view_prefs ? 'recent_folded') then true
              when jsonb_typeof(view_prefs -> 'recent_folded') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'recent_folded') <= 4
               and not jsonb_path_exists(view_prefs, 'strict $.recent_folded[*] ? (@.type() != "string" || !(@ == "files" || @ == "notes" || @ == "library"))') end
        -- [파일] 두 칸 칸별 출처(S52-07 FILES-칸출처고르기, 명진 결정 11/07 4-② A 서버 기억): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐(files_two와 같은 모양)이고
        -- 각 칸은 길이 2 배열 [첫 칸(왼쪽·위) 출처, 둘째 칸(오른쪽·아래) 출처], 출처는 od(원드라이브)·gd(구글 드라이브)·ph(이 폰)·pc(내 PC) 넷 중 하나(글자). 폴더 위치는 넣지 않는다(맨 위에서 시작). 없는 칸은 화면이 지금처럼 정한다.
        and case when not (view_prefs ? 'files_panes') then true
              when jsonb_typeof(view_prefs -> 'files_panes') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_panes.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_panes.* ? (@.type() != "array" || @.size() != 2)') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_panes.*[*] ? (@.type() != "string" || !(@ == "od" || @ == "gd" || @ == "ph" || @ == "pc"))') end
        -- [파일]·사진 저장소 상자 접힘(S52-14 FILES-상자접힘기억, 요청함 11/07 11:33 명진 'ㅇ'): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐(files_sources와 같은 모양)이고
        -- 각 칸은 객체, 그 안 칸은 화면 이름 files([파일])·photos(사진 [폴더]) 둘뿐이며 값은 접은 저장소 배열(4개까지, od·gd·ph·pc 글자). 안쪽 폴더 펼침은 넣지 않는다. 없으면 모두 펼침.
        and case when not (view_prefs ? 'box_shut') then true
              when jsonb_typeof(view_prefs -> 'box_shut') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.* ? (@.type() != "object")') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.*.keyvalue() ? (!(@.key == "files" || @.key == "photos"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.*.* ? (@.type() != "array" || @.size() > 4)') then false
              else not jsonb_path_exists(view_prefs, 'strict $.box_shut.*.*[*] ? (@.type() != "string" || !(@ == "od" || @ == "gd" || @ == "ph" || @ == "pc"))') end
        -- [파일] 두 칸 보기 왼쪽 나무 열어 둠(S52-41 ③ FILES-두칸나무접기, 명진 결정 (가) 11/08): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐(files_two와 같은 모양)이고
        -- 각 칸은 객체, 그 안 칸은 폭 종류 fold(폴드 펼침)·wide(PC) 둘뿐이며 값은 참·거짓. 없으면 접힘.
        and case when not (view_prefs ? 'files_tree') then true
              when jsonb_typeof(view_prefs -> 'files_tree') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_tree.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_tree.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_tree.*.keyvalue() ? (!(@.key == "fold" || @.key == "wide"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_tree.*.* ? (@.type() != "boolean")') end
        -- [파일] 고정한 폴더(S52-41 ④ FILES-폴더고정): 배열 12개까지, 칸마다 'od:<id>'·'gd:<id>' 글자(id 1~200자). 모든 기기 같게. 이름·내 PC 경로는 넣지 않는다(내 PC 고정은 그 PC에만).
        and case when not (view_prefs ? 'files_pins') then true
              when jsonb_typeof(view_prefs -> 'files_pins') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'files_pins') <= 12
               and not jsonb_path_exists(view_prefs, 'strict $.files_pins[*] ? (@.type() != "string" || !(@ like_regex "^(od|gd):.{1,200}$"))') end
        -- [파일] 칸마다 마지막으로 보던 폴더(S52-44 ② FILES-관리자마무리, 요청함 11/08): 배열 2개까지, 칸 차례(0 = 첫 칸·한 칸 보기, 1 = 둘째 칸)마다 객체.
        -- 객체 안 칸은 저장소 od(원드라이브)·gd(구글 드라이브) 둘뿐이고 값은 그 저장소에서 마지막으로 본 폴더 id 글자(1~200자). 폴더 이름·이 폰·내 PC 경로는 넣지 않는다. 없으면 맨 위.
        and case when not (view_prefs ? 'files_last') then true
              when jsonb_typeof(view_prefs -> 'files_last') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'files_last') > 2 then false
              when jsonb_path_exists(view_prefs, 'strict $.files_last[*] ? (@.type() != "object")') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_last[*].keyvalue() ? (!(@.key == "od" || @.key == "gd"))') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_last[*].* ? (@.type() != "string" || !(@ like_regex "^.{1,200}$"))') end
        -- 환류에 쓰는 분류 표식(S53-16 WEEKLY-분류이름바뀜, 요청함 11/08): 객체, 칸 8개까지. 칸 이름 = 역할(소문자 영문으로 시작하는 소문자 영문·숫자·_ 1~30자,
        -- 예: weekly_team = 주간보고 팀 확정본, weekly_personal = 주간보고 개인 확정본), 값 = 그 역할을 맡은 내 분류 이름(1~20자 글자, 제어문자 없음 — 분류 이름 한도와 같음).
        -- 분류 이름을 바꿔도 화면이 이 표식을 새 이름으로 고쳐 환류가 끊기지 않는다. 분류 목록·자료 값은 건드리지 않는다. 없으면 화면이 알려진 이름으로 찾는다.
        and case when not (view_prefs ? 'category_roles') then true
              when jsonb_typeof(view_prefs -> 'category_roles') <> 'object' then false
              when jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.category_roles.keyvalue().key')) > 8 then false
              else not jsonb_path_exists(view_prefs, 'strict $.category_roles.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,29}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.category_roles.* ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{1,20}$"))') end
        -- 조직 보고 표 줄 순서(ORG-줄순서, 요청함 11/09): 'asc'(오래된 것 위, 기본) 또는 'desc'(최신 위) 둘 중 하나(글자여야 한다). 없으면 화면이 asc로 본다.
        and case when not (view_prefs ? 'org_row_order') then true
              else jsonb_typeof(view_prefs -> 'org_row_order') = 'string' and view_prefs ->> 'org_row_order' in ('asc', 'desc') end
        -- 자료실 두 칸 보기 켬(LIB-두칸보기, 요청함 11/09, 명진 18:16 'ㅇ'): 참·거짓 하나(폰·PC 같음). 없으면 화면이 켬(PC·펼친 폴드)으로 본다. 폰은 늘 한 칸.
        and case when not (view_prefs ? 'library_two') then true
              else jsonb_typeof(view_prefs -> 'library_two') = 'boolean' end
        -- 사업 보고 '이번 주 주간보고' 칸 펼침 기억(BIZ-주간보고접힘기억, 요청함 11/10 10:00 '기기별로 기억'): 객체, 칸은 기기 종류 app(폰 앱)·phone(폰 브라우저)·pc(그 밖) 셋뿐
        -- (box_shut·files_tree와 같은 모양)이고 값은 참(펼침)·거짓(접힘). 보고 내용·주 날짜는 넣지 않는다. 없으면 화면이 지금 규칙(주 단위 펼침, 여러 주 접힘)으로 본다.
        and case when not (view_prefs ? 'biz_week_open') then true
              when jsonb_typeof(view_prefs -> 'biz_week_open') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.biz_week_open.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))')
               and not jsonb_path_exists(view_prefs, 'strict $.biz_week_open.* ? (@.type() != "boolean")') end
    end
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 1개가 검증된 상태에서 새 칸과 앞선 칸을 안다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'biz_week_open' and check_clause ~ 'library_two' and check_clause ~ 'org_row_order' and check_clause ~ 'category_roles' and check_clause ~ 'files_last' and check_clause ~ 'files_tree' and check_clause ~ 'files_pins' and check_clause ~ 'box_shut' and check_clause ~ 'files_panes' and check_clause ~ 'recent_folded' and check_clause ~ 'files_look' and check_clause ~ 'news_tab' and check_clause ~ 'news_font' and check_clause ~ 'now_tab' and check_clause ~ 'org_order' and check_clause ~ 'report_calendar' and check_clause ~ 'photo_zoom' and check_clause ~ 'note_sort' and check_clause ~ 'files_two' and check_clause ~ 'files_sources' and check_clause ~ 'col_widths' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_BIZ_WEEK_OPEN_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110170000', 'profile_view_prefs_biz_week_open', array['BIZ-week-fold-pref: app_profiles_view_prefs_check rebuilt on the profile_view_prefs_library_two version also accepting biz_week_open (object of app/phone/pc booleans); every other key and rule unchanged']);
commit;
