begin;
-- NOTE-보드여러개 1/2 DB (요청함 10/30 05:48, 명진 결정 '위 추천안대로'). 노트 포스트잇 화면에 보드를 여러 개 두고,
-- 보드 목록과 마지막에 연 보드를 서버에 기억한다(폰·PC 같음, 기기 저장 없음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_view_prefs_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 받는 칸 열일곱 개에 둘을 더해 열아홉 개로.
--   note_boards = 보드 목록 [{id, name}] 12개까지(id 'b'+소문자 영문·숫자 6~12자, 이름 1~20자). 없으면 보드 없음([전체]만).
--   note_board  = 마지막에 연 보드('all' 또는 보드 id). 없으면 [전체].
--   다른 칸·규칙(전체 4000바이트 상한 포함)은 글자 그대로 같다. 기존 행은 건드리지 않는다.
-- 어느 노트가 어느 보드에 어느 자리로 붙었는지는 이 DB 변경과 무관하다: 노트 행의 기존 metadata jsonb(metadata.boards = {보드 id: {x, y, r, z}})에
--   둔다([전체]의 자리 metadata.board, 고정·폴더와 같은 쓰기 길). 노트 표 검사는 metadata가 객체인지만 본다(바꾸지 않음).
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 칸(열) 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
-- 마이그레이션 본문의 확인은 승인형 workflow 엄격 규칙(do 블록 안 허용 함수 목록) 때문에 앞선 단계와 같이 information_schema로 읽는다.
--   짝 사전·사후 확인 파일은 pg_constraint·pg_get_constraintdef로만 읽는다(information_schema 안 씀).
-- 앞 단계: 20261029183000_profile_view_prefs_note_view 기록이 있어야 한다(없으면 멈춘다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(note_view) 있음, view_prefs 칸 있음,
-- 검사 1개(검증됨, note_view 있음, 아직 note_boards 없음), RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030091000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261029183000' and name = 'profile_view_prefs_note_view') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'view_prefs') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'note_view' and check_clause !~ 'note_boards') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,]])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_NOTE_BOARDS_PREREQUISITE_CHANGED; stop';
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
        -- 칸은 아래 열아홉 개뿐(20261029183000 note_view의 열일곱 개 + note_boards·note_board).
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

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 1개가 검증된 상태에서 새 칸과 앞선 칸을 안다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,]])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'note_boards' and check_clause ~ 'note_view' and check_clause ~ 'quiet_weeks' and check_clause ~ 'reports3' and check_clause ~ 'photo_view' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_NOTE_BOARDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030091000', 'profile_view_prefs_note_boards', array['NOTE-보드여러개: app_profiles_view_prefs_check also accepts note_boards ([{id,name}] up to 12) and note_board (all|board id); no new column, grants, policies or functions']);
commit;
