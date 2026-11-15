begin;
-- S49-11 REPORT-기간고르기(요청함 11/03 10:10): 사업 보고 [전체][주간 보기][기간 설정]에서 고른 기간 보기를 서버에 기억한다(로컬 저장 금지).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_view_prefs_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 받는 칸 서른세 개에 report_period 하나를 더해 서른네 개로.
--   report_period = {mode: 'all'|'week'|'range', from?, to?}. range일 때만 from·to(YYYY-MM-DD, from <= to). 다른 칸 규칙·전체 4000바이트 상한은 글자 그대로 같다. 기존 행은 건드리지 않는다.
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 칸(열) 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
-- 앞 단계: 20261103190000_profile_view_prefs_photo_device(S49-5) 기록이 있어야 한다(없으면 멈춘다). 이 검사는 그 단계의 photo_sources_phone·photo_sources_pc·photo_level까지 그대로 담고 있다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(profile_view_prefs_photo_device) 있음, view_prefs 칸 있음,
-- 검사 1개(검증됨, photo_level·col_widths 있음, 아직 report_period 없음), RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103200000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261103190000' and name = 'profile_view_prefs_photo_device') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'view_prefs') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'photo_sources_phone' and check_clause ~ 'photo_level' and check_clause ~ 'col_widths' and check_clause !~ 'report_period') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_REPORT_PERIOD_PREREQUISITE_CHANGED; stop';
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
        -- 칸은 아래 서른네 개뿐(20261103190000의 서른세 개 + report_period).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive" || @.key == "photo_view" || @.key == "quiet_weeks" || @.key == "note_view" || @.key == "note_boards" || @.key == "note_board" || @.key == "photo_hint" || @.key == "photo_sources" || @.key == "org_tab" || @.key == "tg_view" || @.key == "phone_folders_off" || @.key == "album_view" || @.key == "now_tab" || @.key == "link_hidden_on" || @.key == "ed_more" || @.key == "phone_folders_known" || @.key == "col_widths" || @.key == "photo_sources_phone" || @.key == "photo_sources_pc" || @.key == "photo_level" || @.key == "report_period"))')
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
              else not jsonb_path_exists(view_prefs, 'strict $.split_ratio.keyvalue() ? (!(@.key == "tasks" || @.key == "projects" || @.key == "team" || @.key == "reports" || @.key == "telegram" || @.key == "calls" || @.key == "refs" || @.key == "reports3" || @.key == "photos" || @.key == "arsenal" || @.key == "notes" || @.key == "noteboard" || @.key == "now" || @.key == "files"))')
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
           and check_clause ~ 'report_period' and check_clause ~ 'photo_sources_phone' and check_clause ~ 'photo_level' and check_clause ~ 'col_widths' and check_clause ~ 'phone_folders_known' and check_clause ~ 'ed_more' and check_clause ~ 'link_hidden_on' and check_clause ~ 'collect_hidden_on' and check_clause ~ 'now_tab' and check_clause ~ '"now"' and check_clause ~ '"files"' and check_clause ~ 'album_view' and check_clause ~ 'phone_folders_off' and check_clause ~ 'arsenal' and check_clause ~ 'noteboard' and check_clause ~ 'tg_view' and check_clause ~ 'org_tab' and check_clause ~ 'photo_sources' and check_clause ~ 'photo_hint' and check_clause ~ 'note_boards' and check_clause ~ 'quiet_weeks' and check_clause ~ 'reports3' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_REPORT_PERIOD_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103200000', 'profile_view_prefs_report_period', array['S49-11 REPORT-기간고르기: app_profiles_view_prefs_check also accepts report_period (object: mode all, week or range; from and to dates only for range); no new column, grants, policies or functions']);
commit;
