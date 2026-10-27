begin;
-- UI-화면색재정리 DB (명진 결정 2026-10-27 요청함 15:35: 화면 색 10가지를 겹치는 5개 빼고 산뜻한 5개 더해 다시 정리).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_view_prefs_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦): theme 허용 값을
--   olive·navy·terracotta·sand·mugwort·lavender·ink·rose·teal·mustard 에서 olive·navy·ink·lavender·teal·sky·mint·coral·lemon·red 로 바꾼다(여전히 열 가지).
--   뺀 다섯(terracotta·sand·mugwort·rose·mustard)을 저장해 둔 프로필은 새 검사를 통과할 수 없으므로(검증된 검사를 유지하려면 값이 맞아야 한다)
--   같은 migration 안에서 theme 한 칸만 기본값(olive)으로 바꾼다. 다른 칸(달력 보기·메뉴·노트 폴더·분할 비율 등)은 그대로 둔다.
--   화면은 서버에 없는 색 이름을 이미 기본으로 보여 주므로(view-prefs.js parsePrefs) 사용자가 보는 색은 바뀌지 않는다. 바뀌기 전 원래 값은
--   적용 직전 승인 흐름이 만드는 app_profiles 사본(ops_backup)에 그대로 남는다(snapshot은 앱 표를 읽을 수 없으므로 사본이 보관처다).
--   다른 칸의 규칙(허용 칸 여덟 개·달력 보기 3종·빠른 입력 2종·노트 폴더·분할 비율·사업 보고 보기·숨김 날짜, 전체 4000바이트 상한)은 글자 그대로 같다.
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음, 새 칸 없음. 화면은 기존처럼 내 행만 PATCH한다(task12a owner 정책 그대로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(theme10) 있음, view_prefs 칸 있음,
-- 검사 1개(검증됨, 열 가지 색이 겨자까지 있고 아직 레몬 없음), RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027070000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261027040000' and name = 'profile_view_prefs_theme10') <> 1
     or (select count(*) from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'view_prefs') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'report_view' and check_clause ~ 'mustard' and check_clause !~ 'lemon') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_THEME_REFRESH_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 뺀 다섯 색을 저장해 둔 행: theme 한 칸만 기본(olive)으로. olive는 지금 검사도 허용하는 값이라 바꾸는 중간에 걸리지 않고, 바로 아래에서 검사를 새 목록으로 교체한다.
update public.app_profiles
  set view_prefs = jsonb_set(view_prefs, '{theme}', '"olive"'::jsonb)
  where view_prefs ->> 'theme' in ('terracotta', 'sand', 'mugwort', 'rose', 'mustard');

alter table public.app_profiles drop constraint app_profiles_view_prefs_check;
alter table public.app_profiles
  add constraint app_profiles_view_prefs_check check (
    case
      when view_prefs is null then true
      when jsonb_typeof(view_prefs) <> 'object' then false
      else
        octet_length(view_prefs::text) <= 4000
        -- 칸은 아래 여덟 개뿐(이번에 바뀌는 것은 theme 값 목록뿐).
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view"))')
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
    end
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 검사 1개가 검증된 상태에서 새 열 가지 색만 받고, 뺀 색이 저장된 행이 없다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'lemon' and check_clause ~ 'report_view' and check_clause !~ 'mustard' and check_clause !~ 'terracotta') <> 1
     or exists (select 1 from public.app_profiles where view_prefs ->> 'theme' in ('terracotta', 'sand', 'mugwort', 'rose', 'mustard')) then
    raise exception 'PROFILE_VIEW_PREFS_THEME_REFRESH_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027070000', 'profile_view_prefs_theme_refresh', array['UI-화면색재정리: app_profiles_view_prefs_check accepts theme olive|navy|ink|lavender|teal|sky|mint|coral|lemon|red; saved terracotta|sand|mugwort|rose|mustard theme reset to olive (no new column, grants, policies or functions)']);
commit;
