begin;
-- NOTE-큰생각지도 ② 미니맵(S71-52, 사용자 2026-11-26 19:58 "굉장히 광범위한 생각지도 … 무한정 뻗어나가는"): 노트 보드 미니맵을 접었는지 펼쳤는지를
-- 서버 화면 기억에 둔다(사람별·기기 종류별, 기기 저장 금지). 새 칸 note_board_map = {app|phone|pc: 참·거짓}(1~3칸, 참 = 펼침). 없으면 PC 펼침·폰 접힘.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_profiles_view_prefs_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦). 20261126220000 profile_view_prefs_note_board_bg 판 규칙 그대로에
--   칸 하나(note_board_map)만 더한다. 다른 칸 규칙·전체 4000바이트 상한은 그대로 같다. 기존 행은 건드리지 않는다.
-- 권한: grant·revoke·정책·RLS·함수·트리거·새 열 변경 없음. 프로필 정책은 task12a 두 개 그대로.
-- 앞 단계: 20261126220000_profile_view_prefs_note_board_bg(NOTE-보드배경색) 기록이 있어야 한다(없으면 멈춘다).
-- 짝: docs/20261127010000_profile_view_prefs_note_board_map.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;


do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127010000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261126220000' and name = 'profile_view_prefs_note_board_bg') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version > '20261126220000' and name like 'profile_view_prefs%')
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_view_prefs_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_profiles_view_prefs_check'
           and check_clause ~ 'note_cols' and check_clause ~ 'note_list_sort' and check_clause ~ 'row_size' and check_clause ~ 'note_blocks' and check_clause ~ 'files_sort' and check_clause ~ 'drive_import_folder' and check_clause ~ 'xxl' and check_clause ~ 'home_off' and check_clause ~ 'record_backup' and check_clause ~ 'note_zoom' and check_clause ~ 'biz_week_open' and check_clause ~ 'library_two' and check_clause ~ 'org_row_order' and check_clause ~ 'category_roles' and check_clause ~ 'files_last' and check_clause ~ 'files_tree' and check_clause ~ 'files_pins' and check_clause ~ 'box_shut' and check_clause ~ 'files_panes' and check_clause ~ 'recent_folded' and check_clause ~ 'files_look' and check_clause ~ 'news_tab' and check_clause ~ 'news_font' and check_clause ~ 'now_tab' and check_clause ~ 'org_order' and check_clause ~ 'report_calendar' and check_clause ~ 'photo_zoom' and check_clause ~ 'note_sort' and check_clause ~ 'files_two' and check_clause ~ 'files_sources' and check_clause ~ 'col_widths' and check_clause ~ 'home_cards' and check_clause ~ '"library"' and check_clause ~ '"reading"' and check_clause ~ 'files_prev_shut' and check_clause ~ 'brief_sort' and check_clause ~ '"brief"' and check_clause ~ 'note_board_bg' and check_clause !~ 'note_board_map') <> 1
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
    raise exception 'PROFILE_VIEW_PREFS_NOTE_BOARD_MAP_PREREQUISITE_CHANGED; stop';
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
        and not jsonb_path_exists(view_prefs, 'strict $.keyvalue() ? (!(@.key == "theme" || @.key == "nav_collapsed" || @.key == "calendar_view" || @.key == "home_quick_mode" || @.key == "note_folder" || @.key == "split_ratio" || @.key == "collect_hidden_on" || @.key == "report_view" || @.key == "menu_layout" || @.key == "home_cards" || @.key == "photo_cols" || @.key == "photo_cols_wide" || @.key == "diary_view" || @.key == "diary_onedrive" || @.key == "photo_view" || @.key == "quiet_weeks" || @.key == "note_view" || @.key == "note_boards" || @.key == "note_board" || @.key == "photo_hint" || @.key == "photo_sources" || @.key == "org_tab" || @.key == "tg_view" || @.key == "phone_folders_off" || @.key == "album_view" || @.key == "now_tab" || @.key == "link_hidden_on" || @.key == "ed_more" || @.key == "phone_folders_known" || @.key == "col_widths" || @.key == "photo_sources_phone" || @.key == "photo_sources_pc" || @.key == "photo_level" || @.key == "report_period" || @.key == "files_sources" || @.key == "files_dest_recent" || @.key == "files_two" || @.key == "note_sort" || @.key == "photo_zoom" || @.key == "org_order" || @.key == "report_calendar" || @.key == "news_tab" || @.key == "news_font" || @.key == "files_look" || @.key == "recent_folded" || @.key == "files_panes" || @.key == "box_shut" || @.key == "files_tree" || @.key == "files_pins" || @.key == "files_last" || @.key == "category_roles" || @.key == "org_row_order" || @.key == "library_two" || @.key == "biz_week_open" || @.key == "note_zoom" || @.key == "record_backup" || @.key == "home_off" || @.key == "drive_import_folder" || @.key == "files_sort" || @.key == "note_blocks" || @.key == "row_size" || @.key == "note_list_sort" || @.key == "note_cols" || @.key == "files_prev_shut" || @.key == "brief_sort" || @.key == "note_board_bg" || @.key == "note_board_map"))')
        and case when not (view_prefs ? 'theme') then true
              else jsonb_typeof(view_prefs -> 'theme') = 'string' and view_prefs ->> 'theme' in ('olive', 'navy', 'ink', 'lavender', 'teal', 'sky', 'mint', 'coral', 'lemon', 'red') end
        and case when not (view_prefs ? 'nav_collapsed') then true
              else jsonb_typeof(view_prefs -> 'nav_collapsed') = 'boolean' end
        and case when not (view_prefs ? 'calendar_view') then true
              else jsonb_typeof(view_prefs -> 'calendar_view') = 'string' and view_prefs ->> 'calendar_view' in ('list', 'week', 'month') end
        and case when not (view_prefs ? 'home_quick_mode') then true
              else jsonb_typeof(view_prefs -> 'home_quick_mode') = 'string' and view_prefs ->> 'home_quick_mode' in ('update', 'task') end
        and case when not (view_prefs ? 'note_folder') then true
              when jsonb_typeof(view_prefs -> 'note_folder') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.note_folder ? (@ like_regex "^(all|none|f:[^[:cntrl:]]{1,20})$")') end
        and case when not (view_prefs ? 'split_ratio') then true
              when jsonb_typeof(view_prefs -> 'split_ratio') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.split_ratio.keyvalue() ? (!(@.key == "tasks" || @.key == "projects" || @.key == "team" || @.key == "reports" || @.key == "telegram" || @.key == "calls" || @.key == "refs" || @.key == "reports3" || @.key == "photos" || @.key == "arsenal" || @.key == "notes" || @.key == "noteboard" || @.key == "now" || @.key == "files" || @.key == "library" || @.key == "reading" || @.key == "brief"))')
               and not jsonb_path_exists(view_prefs, 'strict $.split_ratio.* ? (@.type() != "number" || @ <= 0 || @ >= 1)') end
        and case when not (view_prefs ? 'report_view') then true
              else jsonb_typeof(view_prefs -> 'report_view') = 'string' and view_prefs ->> 'report_view' in ('list', 'calendar', 'photo') end
        and case when not (view_prefs ? 'collect_hidden_on') then true
              when jsonb_typeof(view_prefs -> 'collect_hidden_on') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.collect_hidden_on ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")') end
        and case when not (view_prefs ? 'menu_layout') then true
              when jsonb_typeof(view_prefs -> 'menu_layout') <> 'object' then false
              when jsonb_typeof(view_prefs -> 'menu_layout' -> 'bar') is distinct from 'array'
                or jsonb_typeof(view_prefs -> 'menu_layout' -> 'rest') is distinct from 'array' then false
              else jsonb_array_length(view_prefs -> 'menu_layout' -> 'bar') <= 6
               and jsonb_array_length(view_prefs -> 'menu_layout' -> 'rest') <= 24
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.keyvalue() ? (!(@.key == "bar" || @.key == "rest"))')
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.bar[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.menu_layout.rest[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))') end
        and case when not (view_prefs ? 'home_cards') then true
              when jsonb_typeof(view_prefs -> 'home_cards') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'home_cards') <= 24
               and not jsonb_path_exists(view_prefs, 'strict $.home_cards[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))') end
        and case when not (view_prefs ? 'photo_cols') then true
              else jsonb_typeof(view_prefs -> 'photo_cols') = 'number' and view_prefs ->> 'photo_cols' in ('2', '3', '4', '6') end
        and case when not (view_prefs ? 'photo_cols_wide') then true
              else jsonb_typeof(view_prefs -> 'photo_cols_wide') = 'number' and view_prefs ->> 'photo_cols_wide' in ('6', '8', '10') end
        and case when not (view_prefs ? 'diary_view') then true
              else jsonb_typeof(view_prefs -> 'diary_view') = 'string' and view_prefs ->> 'diary_view' in ('calendar', 'list') end
        and case when not (view_prefs ? 'diary_onedrive') then true
              else jsonb_typeof(view_prefs -> 'diary_onedrive') = 'boolean' end
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
        and case when not (view_prefs ? 'quiet_weeks') then true
              else jsonb_typeof(view_prefs -> 'quiet_weeks') = 'number' and view_prefs ->> 'quiet_weeks' in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12') end
        and case when not (view_prefs ? 'note_view') then true
              else jsonb_typeof(view_prefs -> 'note_view') = 'string' and view_prefs ->> 'note_view' in ('folder', 'list', 'board') end
        and case when not (view_prefs ? 'note_boards') then true
              when jsonb_typeof(view_prefs -> 'note_boards') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'note_boards') > 12 then false
              when jsonb_path_exists(view_prefs, 'strict $.note_boards[*] ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.note_boards[*].keyvalue() ? (!(@.key == "id" || @.key == "name"))')
               and jsonb_array_length(jsonb_path_query_array(view_prefs, 'lax $.note_boards[*] ? (@.id.type() == "string" && @.id like_regex "^b[0-9a-z]{6,12}$" && @.name.type() == "string" && @.name like_regex "^[^[:cntrl:]]{1,20}$")'))
                   = jsonb_array_length(view_prefs -> 'note_boards') end
        and case when not (view_prefs ? 'note_board') then true
              when jsonb_typeof(view_prefs -> 'note_board') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.note_board ? (@ like_regex "^(all|b[0-9a-z]{6,12})$")') end
        and case when not (view_prefs ? 'photo_hint') then true
              else jsonb_typeof(view_prefs -> 'photo_hint') = 'number' and view_prefs ->> 'photo_hint' in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9') end
        and case when not (view_prefs ? 'photo_sources') then true
              when jsonb_typeof(view_prefs -> 'photo_sources') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'org_tab') then true
              else jsonb_typeof(view_prefs -> 'org_tab') = 'string' and view_prefs ->> 'org_tab' in ('log', 'table') end
        and case when not (view_prefs ? 'tg_view') then true
              else jsonb_typeof(view_prefs -> 'tg_view') = 'string' and view_prefs ->> 'tg_view' in ('day', 'room') end
        and case when not (view_prefs ? 'phone_folders_off') then true
              when jsonb_typeof(view_prefs -> 'phone_folders_off') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'phone_folders_off') <= 80
               and not jsonb_path_exists(view_prefs, 'strict $.phone_folders_off[*] ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{0,255}$"))') end
        and case when not (view_prefs ? 'album_view') then true
              else jsonb_typeof(view_prefs -> 'album_view') = 'string' and view_prefs ->> 'album_view' in ('card', 'thumb', 'line') end
        and case when not (view_prefs ? 'now_tab') then true
              else jsonb_typeof(view_prefs -> 'now_tab') = 'string' and view_prefs ->> 'now_tab' in ('outside', 'news', 'saved', 'search') end
        and case when not (view_prefs ? 'link_hidden_on') then true
              when jsonb_typeof(view_prefs -> 'link_hidden_on') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.link_hidden_on ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")') end
        and case when not (view_prefs ? 'ed_more') then true
              else jsonb_typeof(view_prefs -> 'ed_more') = 'boolean' end
        and case when not (view_prefs ? 'phone_folders_known') then true
              when jsonb_typeof(view_prefs -> 'phone_folders_known') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'phone_folders_known') <= 120
               and not jsonb_path_exists(view_prefs, 'strict $.phone_folders_known[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-f]{8}$"))') end
        and case when not (view_prefs ? 'col_widths') then true
              when jsonb_typeof(view_prefs -> 'col_widths') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.col_widths.* ? (@.type() != "object")') then false
              else jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.col_widths.keyvalue().key')) <= 12
               and not jsonb_path_exists(view_prefs, 'strict $.col_widths.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,19}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.col_widths.*.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,19}$") || @.value.type() != "number" || @.value < 40 || @.value > 800)') end
        and case when not (view_prefs ? 'photo_sources_phone') then true
              when jsonb_typeof(view_prefs -> 'photo_sources_phone') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources_phone.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources_phone.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'photo_sources_pc') then true
              when jsonb_typeof(view_prefs -> 'photo_sources_pc') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_sources_pc.keyvalue() ? (!(@.key == "onedrive" || @.key == "gdrive" || @.key == "phone"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_sources_pc.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'photo_level') then true
              else jsonb_typeof(view_prefs -> 'photo_level') = 'string' and view_prefs ->> 'photo_level' in ('year', 'month', 'day') end
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
        and case when not (view_prefs ? 'files_sources') then true
              when jsonb_typeof(view_prefs -> 'files_sources') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_sources.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_sources.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_sources.*.keyvalue() ? (!(@.key == "od" || @.key == "gd"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_sources.*.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'files_dest_recent') then true
              when jsonb_typeof(view_prefs -> 'files_dest_recent') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'files_dest_recent') > 3 then false
              when jsonb_path_exists(view_prefs, 'strict $.files_dest_recent[*] ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_dest_recent[*].keyvalue() ? (!(@.key == "source" || @.key == "id" || @.key == "name"))')
               and jsonb_array_length(jsonb_path_query_array(view_prefs, 'lax $.files_dest_recent[*] ? (@.source.type() == "string" && (@.source == "od" || @.source == "gd") && @.id.type() == "string" && @.id like_regex "^[A-Za-z0-9!_.-]{0,120}$" && @.name.type() == "string" && @.name like_regex "^[^[:cntrl:]]{1,40}$")'))
                   = jsonb_array_length(view_prefs -> 'files_dest_recent') end
        and case when not (view_prefs ? 'files_two') then true
              when jsonb_typeof(view_prefs -> 'files_two') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_two.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_two.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_two.*.keyvalue() ? (!(@.key == "fold" || @.key == "wide" || @.key == "narrow"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_two.*.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'note_sort') then true
              else jsonb_typeof(view_prefs -> 'note_sort') = 'string' and view_prefs ->> 'note_sort' in ('changed', 'manual') end
        and case when not (view_prefs ? 'photo_zoom') then true
              when jsonb_typeof(view_prefs -> 'photo_zoom') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.photo_zoom.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))')
               and not jsonb_path_exists(view_prefs, 'strict $.photo_zoom.* ? (@.type() != "string" || !(@ == "year" || @ == "month" || @ == "day"))') end
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
        and case when not (view_prefs ? 'report_calendar') then true
              when jsonb_typeof(view_prefs -> 'report_calendar') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.report_calendar ? (@ like_regex "^[^[:cntrl:]]{1,60}$")') end
        and case when not (view_prefs ? 'news_tab') then true
              else jsonb_typeof(view_prefs -> 'news_tab') = 'string' and view_prefs ->> 'news_tab' in ('all', 'movement', 'media', 'archive') end
        and case when not (view_prefs ? 'news_font') then true
              else jsonb_typeof(view_prefs -> 'news_font') = 'string' and view_prefs ->> 'news_font' in ('s', 'm', 'l', 'xl', 'xxl') end
        and case when not (view_prefs ? 'files_look') then true
              when jsonb_typeof(view_prefs -> 'files_look') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_look.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_look.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_look.*.keyvalue() ? (!(@.key == "narrow" || @.key == "fold" || @.key == "wide"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_look.*.* ? (@.type() != "string" || !(@ == "list" || @ == "grid" || @ == "big"))') end
        and case when not (view_prefs ? 'recent_folded') then true
              when jsonb_typeof(view_prefs -> 'recent_folded') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'recent_folded') <= 4
               and not jsonb_path_exists(view_prefs, 'strict $.recent_folded[*] ? (@.type() != "string" || !(@ == "files" || @ == "notes" || @ == "library"))') end
        and case when not (view_prefs ? 'files_panes') then true
              when jsonb_typeof(view_prefs -> 'files_panes') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_panes.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_panes.* ? (@.type() != "array" || @.size() != 2)') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_panes.*[*] ? (@.type() != "string" || !(@ == "od" || @ == "gd" || @ == "ph" || @ == "pc"))') end
        and case when not (view_prefs ? 'box_shut') then true
              when jsonb_typeof(view_prefs -> 'box_shut') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.* ? (@.type() != "object")') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.*.keyvalue() ? (!(@.key == "files" || @.key == "photos"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.box_shut.*.* ? (@.type() != "array" || @.size() > 4)') then false
              else not jsonb_path_exists(view_prefs, 'strict $.box_shut.*.*[*] ? (@.type() != "string" || !(@ == "od" || @ == "gd" || @ == "ph" || @ == "pc"))') end
        and case when not (view_prefs ? 'files_tree') then true
              when jsonb_typeof(view_prefs -> 'files_tree') <> 'object' then false
              when jsonb_path_exists(view_prefs, 'strict $.files_tree.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_tree.* ? (@.type() != "object")') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_tree.*.keyvalue() ? (!(@.key == "fold" || @.key == "wide"))')
               and not jsonb_path_exists(view_prefs, 'strict $.files_tree.*.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'files_pins') then true
              when jsonb_typeof(view_prefs -> 'files_pins') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'files_pins') <= 12
               and not jsonb_path_exists(view_prefs, 'strict $.files_pins[*] ? (@.type() != "string" || !(@ like_regex "^(od|gd):.{1,200}$"))') end
        and case when not (view_prefs ? 'files_last') then true
              when jsonb_typeof(view_prefs -> 'files_last') <> 'array' then false
              when jsonb_array_length(view_prefs -> 'files_last') > 2 then false
              when jsonb_path_exists(view_prefs, 'strict $.files_last[*] ? (@.type() != "object")') then false
              when jsonb_path_exists(view_prefs, 'strict $.files_last[*].keyvalue() ? (!(@.key == "od" || @.key == "gd"))') then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_last[*].* ? (@.type() != "string" || !(@ like_regex "^.{1,200}$"))') end
        and case when not (view_prefs ? 'category_roles') then true
              when jsonb_typeof(view_prefs -> 'category_roles') <> 'object' then false
              when jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.category_roles.keyvalue().key')) > 8 then false
              else not jsonb_path_exists(view_prefs, 'strict $.category_roles.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,29}$"))')
               and not jsonb_path_exists(view_prefs, 'strict $.category_roles.* ? (@.type() != "string" || !(@ like_regex "^[^[:cntrl:]]{1,20}$"))') end
        and case when not (view_prefs ? 'org_row_order') then true
              else jsonb_typeof(view_prefs -> 'org_row_order') = 'string' and view_prefs ->> 'org_row_order' in ('asc', 'desc') end
        and case when not (view_prefs ? 'library_two') then true
              else jsonb_typeof(view_prefs -> 'library_two') = 'boolean' end
        and case when not (view_prefs ? 'biz_week_open') then true
              when jsonb_typeof(view_prefs -> 'biz_week_open') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.biz_week_open.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc"))')
               and not jsonb_path_exists(view_prefs, 'strict $.biz_week_open.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'note_zoom') then true
              else jsonb_typeof(view_prefs -> 'note_zoom') = 'number' and (view_prefs ->> 'note_zoom') in ('80', '90', '100', '110', '125', '150') end
        and case when not (view_prefs ? 'record_backup') then true
              when jsonb_typeof(view_prefs -> 'record_backup') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.record_backup.keyvalue() ? (!(@.key == "auto" || @.key == "intro"))')
               and not jsonb_path_exists(view_prefs, 'strict $.record_backup.* ? (@.type() != "boolean")') end
        and case when not (view_prefs ? 'home_off') then true
              when jsonb_typeof(view_prefs -> 'home_off') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'home_off') <= 12
               and not jsonb_path_exists(view_prefs, 'strict $.home_off[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_-]{0,29}$"))') end
        and case when not (view_prefs ? 'drive_import_folder') then true
              when jsonb_typeof(view_prefs -> 'drive_import_folder') <> 'string' then false
              else jsonb_path_exists(view_prefs, 'lax $.drive_import_folder ? (@ like_regex "^[A-Za-z0-9_-]{10,200}$")') end
        and case when not (view_prefs ? 'files_sort') then true
              when jsonb_typeof(view_prefs -> 'files_sort') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.files_sort.keyvalue() ? (!(@.key == "key" || @.key == "dir"))')
               and (view_prefs -> 'files_sort') ? 'key' and (view_prefs -> 'files_sort') ? 'dir'
               and jsonb_typeof(view_prefs -> 'files_sort' -> 'key') = 'string' and (view_prefs -> 'files_sort' ->> 'key') in ('name', 'modified', 'size', 'kind')
               and jsonb_typeof(view_prefs -> 'files_sort' -> 'dir') = 'string' and (view_prefs -> 'files_sort' ->> 'dir') in ('asc', 'desc') end
        and case when not (view_prefs ? 'note_blocks') then true
              else jsonb_typeof(view_prefs -> 'note_blocks') = 'boolean' end
        and case when not (view_prefs ? 'row_size') then true
              else jsonb_typeof(view_prefs -> 'row_size') = 'string' and view_prefs ->> 'row_size' in ('s', 'l', 'xl') end
        and case when not (view_prefs ? 'note_list_sort') then true
              when jsonb_typeof(view_prefs -> 'note_list_sort') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.note_list_sort.keyvalue() ? (!(@.key == "key" || @.key == "dir"))')
               and (view_prefs -> 'note_list_sort') ? 'key' and (view_prefs -> 'note_list_sort') ? 'dir'
               and jsonb_typeof(view_prefs -> 'note_list_sort' -> 'key') = 'string' and (view_prefs -> 'note_list_sort' ->> 'key') in ('title', 'folder', 'changed', 'created', 'clip', 'memo', 'chars')
               and jsonb_typeof(view_prefs -> 'note_list_sort' -> 'dir') = 'string' and (view_prefs -> 'note_list_sort' ->> 'dir') in ('asc', 'desc') end
        and case when not (view_prefs ? 'note_cols') then true
              when jsonb_typeof(view_prefs -> 'note_cols') <> 'array' then false
              else jsonb_array_length(view_prefs -> 'note_cols') <= 8
               and not jsonb_path_exists(view_prefs, 'strict $.note_cols[*] ? (@.type() != "string" || !(@ == "folder" || @ == "tags" || @ == "day" || @ == "made" || @ == "clip" || @ == "memo" || @ == "chars" || @ == "pub"))') end
        and case when not (view_prefs ? 'files_prev_shut') then true
              else jsonb_typeof(view_prefs -> 'files_prev_shut') = 'boolean' end
        and case when not (view_prefs ? 'brief_sort') then true
              when jsonb_typeof(view_prefs -> 'brief_sort') <> 'object' then false
              else not jsonb_path_exists(view_prefs, 'strict $.brief_sort.keyvalue() ? (!(@.key == "key" || @.key == "dir"))')
               and (view_prefs -> 'brief_sort') ? 'key' and (view_prefs -> 'brief_sort') ? 'dir'
               and jsonb_typeof(view_prefs -> 'brief_sort' -> 'key') = 'string' and (view_prefs -> 'brief_sort' ->> 'key') in ('name', 'modified', 'size', 'kind')
               and jsonb_typeof(view_prefs -> 'brief_sort' -> 'dir') = 'string' and (view_prefs -> 'brief_sort' ->> 'dir') in ('asc', 'desc') end
        -- 보드 바탕색(S71-50 NOTE-보드배경색): 객체 {보드 id: 색 이름}, 1~12칸. 보드 id는 note_boards와 같은 모양, 색은 여덟 가지 이름만(실제 색 값은 화면 CSS).
        -- 비면 칸을 지운다(빈 객체는 받지 않음). 보드 이름·노트 내용은 넣지 않는다. 없으면 모든 보드가 기본 바탕.
        and case when not (view_prefs ? 'note_board_bg') then true
              when jsonb_typeof(view_prefs -> 'note_board_bg') <> 'object' then false
              else jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.note_board_bg.keyvalue()')) between 1 and 12
               and not jsonb_path_exists(view_prefs, 'strict $.note_board_bg.keyvalue() ? (!(@.key like_regex "^b[0-9a-z]{6,12}$") || @.value.type() != "string" || !(@.value == "sand" || @.value == "sage" || @.value == "sky" || @.value == "lilac" || @.value == "peach" || @.value == "mint" || @.value == "rose" || @.value == "gray"))') end
        -- 미니맵 접기·펴기(S71-52 NOTE-큰생각지도 ②): 객체 {기기 종류: 참·거짓}, 1~3칸, 기기 종류는 box_shut·files_tree와 같은 app·phone·pc만.
        and case when not (view_prefs ? 'note_board_map') then true
              when jsonb_typeof(view_prefs -> 'note_board_map') <> 'object' then false
              else jsonb_array_length(jsonb_path_query_array(view_prefs, 'strict $.note_board_map.keyvalue()')) between 1 and 3
               and not jsonb_path_exists(view_prefs, 'strict $.note_board_map.keyvalue() ? (!(@.key == "app" || @.key == "phone" || @.key == "pc") || @.value.type() != "boolean")') end
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
           and check_clause ~ 'note_board_map' and check_clause ~ 'note_board_bg' and check_clause ~ 'brief_sort' and check_clause ~ '"brief"' and check_clause ~ 'files_prev_shut' and check_clause ~ '"reading"' and check_clause ~ 'note_cols' and check_clause ~ 'note_list_sort' and check_clause ~ 'row_size' and check_clause ~ 'note_blocks' and check_clause ~ 'files_sort' and check_clause ~ 'drive_import_folder' and check_clause ~ 'xxl' and check_clause ~ 'home_off' and check_clause ~ 'record_backup' and check_clause ~ 'note_zoom' and check_clause ~ 'biz_week_open' and check_clause ~ 'library_two' and check_clause ~ 'org_row_order' and check_clause ~ 'category_roles' and check_clause ~ 'files_last' and check_clause ~ 'files_tree' and check_clause ~ 'files_pins' and check_clause ~ 'box_shut' and check_clause ~ 'files_panes' and check_clause ~ 'recent_folded' and check_clause ~ 'files_look' and check_clause ~ 'news_tab' and check_clause ~ 'news_font' and check_clause ~ 'now_tab' and check_clause ~ 'org_order' and check_clause ~ 'report_calendar' and check_clause ~ 'photo_zoom' and check_clause ~ 'note_sort' and check_clause ~ 'files_two' and check_clause ~ 'files_sources' and check_clause ~ 'col_widths' and check_clause ~ 'home_cards') <> 1 then
    raise exception 'PROFILE_VIEW_PREFS_NOTE_BOARD_MAP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127010000', 'profile_view_prefs_note_board_map', array['NOTE-big-map: app_profiles_view_prefs_check rebuilt on the profile_view_prefs_note_board_bg version with one more key, note_board_map (object device kind app/phone/pc -> boolean, 1-3 entries); every other key and rule unchanged']);
commit;
