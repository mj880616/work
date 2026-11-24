// Synthetic prerequisite fixture for 20261124130000_account_delete. No production connection, made-up ids only.
// basket4-fixture.mjs(작업공간 A·B, 프로젝트·조직·보고) 위에 운영과 같은 모양의 표 몇 개를 더한다.
// - 휴지통 가로채기 트리거(app_notes·app_spaces)는 운영 트리거와 같은 규칙(이미 휴지통이거나 트리거 깊이 2 이상이면 실제 삭제).
// - app_spaces·app_meetings·app_suborganizations·app_events는 작업공간 연결이 cascade가 아니다(저장소 migration 전 표처럼) → 함수가 직접 지워야 한다.
// - app_record_links → app_reference_bundles는 restrict(운영과 같음) → 연결을 먼저 지워야 한다.
// - 묶음 표는 저장소 migration(20261118110000_collab_groups) 원문을 그대로 쓴다(시험 파일이 읽어 넣음).
import {OWNER, STRANGER, WS_A, WS_B, PROJECT_A, PROJECT_A2, PROJECT_B} from './basket4-fixture.mjs';

export const USER_C = '20000000-0000-4000-8000-0000000000c3'; // 운영자(통화 허용)
export const USER_D = '20000000-0000-4000-8000-0000000000d4'; // 같은 작업공간 owner 둘(옛 협업 잔재)
export const USER_E = '20000000-0000-4000-8000-0000000000e5';
export const USER_F = '20000000-0000-4000-8000-0000000000f6'; // 남이 있는 묶음의 관리자
export const WS_C = '21000000-0000-4000-8000-0000000000c3';
export const WS_D = '21000000-0000-4000-8000-0000000000d4';
export const WS_F = '21000000-0000-4000-8000-0000000000f6';
export const PAGE_A = '31000000-0000-4000-8000-00000000000a', PAGE_B = '31000000-0000-4000-8000-00000000000b';
export const MEDIA_A = '32000000-0000-4000-8000-00000000000a', MEDIA_B = '32000000-0000-4000-8000-00000000000b', MEDIA_X = '32000000-0000-4000-8000-0000000000ee';
export const EVENT_A = '33000000-0000-4000-8000-00000000000a', EVENT_B = '33000000-0000-4000-8000-00000000000b';
export const GROUP_ALONE = '34000000-0000-4000-8000-000000000001', GROUP_SHARED = '34000000-0000-4000-8000-000000000002', GROUP_F = '34000000-0000-4000-8000-000000000003';

// 묶음 migration이 읽는 앞 단계(프로필 표·migration 기록)와 읽기 전용 확인 역할·auth.jwt().
export const prerequisites = `
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261115223000','profile_union_department');
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,union_name text,department_name text);
  alter table public.app_profiles enable row level security;
  revoke all on table public.app_profiles from public, anon, authenticated, service_role;
  grant select, insert, update on table public.app_profiles to authenticated;
  create policy task12a_owner_all on public.app_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  revoke usage on schema private from service_role;`;

// 묶음 migration을 넣은 뒤에 넣는 표·자료.
export const accountFixture = `
  create table public.app_operator_features(workspace_id uuid not null references public.app_workspaces(id) on delete cascade, feature text not null, primary key (workspace_id, feature));
  create table public.app_share_pages(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text, deleted_at timestamptz);
  create table public.app_share_page_media(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    page_id uuid not null references public.app_share_pages(id) on delete cascade, storage_path text not null);
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    kind text not null default 'note', body text, deleted_at timestamptz);
  create function private.fixture_trash_note() returns trigger language plpgsql security definer set search_path = '' as $f$
  begin
    if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then return old; end if;
    update public.app_notes set deleted_at = pg_catalog.now() where id = old.id and deleted_at is null;
    return null;
  end $f$;
  create trigger app_notes_a_trash_before_delete before delete on public.app_notes for each row execute function private.fixture_trash_note();
  alter table public.app_spaces add column parent_id uuid references public.app_spaces(id), add column deleted_at timestamptz;
  create function private.fixture_trash_space() returns trigger language plpgsql security definer set search_path = '' as $f$
  begin
    if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then return old; end if;
    update public.app_spaces set deleted_at = pg_catalog.now() where workspace_id = old.workspace_id and deleted_at is null;
    return null;
  end $f$;
  create trigger app_spaces_a_trash_before_delete before delete on public.app_spaces for each row execute function private.fixture_trash_space();
  create table public.app_events(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), project_id uuid references public.app_spaces(id), title text);
  create table public.app_event_photos(id uuid primary key default gen_random_uuid(), event_id uuid not null references public.app_events(id) on delete cascade, storage_path text, thumb_path text);
  create table public.app_reference_bundles(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade);
  create table public.app_record_links(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    bundle_id uuid references public.app_reference_bundles(id) on delete restrict);
  create table public.app_drive_connections(workspace_id uuid primary key references public.app_workspaces(id) on delete cascade, google_refresh_token text not null);
  create table public.app_google_calendar_connections(user_id uuid primary key, refresh_token text);
  create table public.app_feature_locks(user_id uuid primary key, pin_hash text);
  create table public.app_feedback(id uuid primary key default gen_random_uuid(), user_id uuid not null, workspace_id uuid, body text);
  create table public.app_space_members(project_id uuid not null references public.app_spaces(id) on delete cascade, user_id uuid not null);
  create table public.app_tg_day_senders(workspace_id uuid not null, label text);
  alter table public.app_meetings enable row level security;
  alter table public.app_drive_connections enable row level security;
  alter table public.app_google_calendar_connections enable row level security;
  revoke all on table public.app_drive_connections, public.app_google_calendar_connections from anon, authenticated, service_role;

  insert into public.app_workspaces values ('${WS_C}'), ('${WS_D}'), ('${WS_F}');
  insert into public.app_workspace_members values ('${WS_C}', '${USER_C}', 'owner'), ('${WS_D}', '${USER_D}', 'owner'), ('${WS_D}', '${USER_E}', 'owner'), ('${WS_F}', '${USER_F}', 'owner');
  insert into public.app_operator_features values ('${WS_C}', 'calls');
  insert into public.app_profiles(user_id, display_name) values ('${OWNER}', '가상 나'), ('${STRANGER}', '가상 남'), ('${USER_F}', '가상 여섯');
  update public.app_spaces set parent_id = '${PROJECT_A}' where id = '${PROJECT_A2}';
  insert into public.app_share_pages(id, workspace_id, title) values ('${PAGE_A}', '${WS_A}', '가상 페이지'), ('${PAGE_B}', '${WS_B}', '가상 남 페이지');
  insert into public.app_share_page_media values
    ('${MEDIA_A}', '${WS_A}', '${PAGE_A}', '${PAGE_A}/${MEDIA_A}.jpg'),
    ('${MEDIA_B}', '${WS_B}', '${PAGE_B}', '${PAGE_B}/${MEDIA_B}.jpg'),
    -- 내 작업공간 줄인데 남의 페이지를 가리키는 줄: 지우기는 하되 그 파일 경로는 돌려주지 않아야 한다.
    ('${MEDIA_X}', '${WS_A}', '${PAGE_B}', '${PAGE_B}/${MEDIA_X}.jpg');
  insert into public.app_notes(workspace_id, kind, body, deleted_at) values
    ('${WS_A}', 'note', '가상 노트', null), ('${WS_A}', 'basket', '가상 휴지통 노트', now()), ('${WS_B}', 'note', '가상 남 노트', null);
  insert into public.app_events values ('${EVENT_A}', '${WS_A}', '${PROJECT_A}', '가상 일정'), ('${EVENT_B}', '${WS_B}', '${PROJECT_B}', '가상 남 일정');
  insert into public.app_event_photos(event_id, storage_path, thumb_path) values
    ('${EVENT_A}', '${EVENT_A}/p1.jpg', '${EVENT_A}/p1-thumb.jpg'),
    ('${EVENT_A}', '${EVENT_B}/stolen.jpg', null),
    ('${EVENT_B}', '${EVENT_B}/p2.jpg', '${EVENT_B}/p2-thumb.jpg');
  with b as (insert into public.app_reference_bundles(workspace_id) values ('${WS_A}') returning id)
    insert into public.app_record_links(workspace_id, bundle_id) select '${WS_A}', id from b;
  with b as (insert into public.app_reference_bundles(workspace_id) values ('${WS_B}') returning id)
    insert into public.app_record_links(workspace_id, bundle_id) select '${WS_B}', id from b;
  insert into public.app_drive_connections values ('${WS_A}', 'synthetic-token-a'), ('${WS_B}', 'synthetic-token-b');
  insert into public.app_google_calendar_connections values ('${OWNER}', 'synthetic-cal-a'), ('${STRANGER}', 'synthetic-cal-b');
  insert into public.app_feature_locks values ('${OWNER}', 'x'), ('${STRANGER}', 'y');
  insert into public.app_feedback(user_id, workspace_id, body) values ('${OWNER}', '${WS_A}', '가상 의견'), ('${OWNER}', null, '가상 의견 둘'), ('${STRANGER}', '${WS_B}', '가상 남 의견');
  insert into public.app_space_members values ('${PROJECT_A}', '${STRANGER}'), ('${PROJECT_B}', '${OWNER}');
  insert into public.app_tg_day_senders values ('${WS_A}', '가상'), ('${WS_B}', '가상 남');

  insert into public.app_collab_groups(id, kind, union_name, name_key, created_by) values
    ('${GROUP_ALONE}', 'union', '가상 노조', '가상노조', '${OWNER}'),
    ('${GROUP_SHARED}', 'union', '가상 남 노조', '가상남노조', '${STRANGER}'),
    ('${GROUP_F}', 'union', '가상 여섯 노조', '가상여섯노조', '${USER_F}');
  insert into public.app_collab_members(group_id, user_id, workspace_id, member_role, display_name) values
    ('${GROUP_ALONE}', '${OWNER}', '${WS_A}', 'admin', '가상 나'),
    ('${GROUP_SHARED}', '${STRANGER}', '${WS_B}', 'admin', '가상 남'),
    ('${GROUP_SHARED}', '${OWNER}', '${WS_A}', 'member', '가상 나'),
    ('${GROUP_F}', '${USER_F}', '${WS_F}', 'admin', '가상 여섯'),
    ('${GROUP_F}', '${STRANGER}', '${WS_B}', 'member', '가상 남');
  insert into public.app_collab_member_log(group_id, user_id, event) values ('${GROUP_SHARED}', '${OWNER}', 'join');
  insert into public.app_collab_join_requests(group_id, requester_user_id, requester_display_name) values ('${GROUP_F}', '${OWNER}', '가상 나');
  insert into public.app_collab_join_attempts(user_id) values ('${OWNER}');
`;

// 작업공간·사람별 줄 수(내용 없이 숫자만). 지운 뒤 나(A)는 0, 남(B)은 그대로여야 한다.
export const countsSQL = (ws, user) => `
  select 'workspaces' k, count(*)::int n from public.app_workspaces where id = '${ws}'
  union all select 'members', count(*)::int from public.app_workspace_members where workspace_id = '${ws}'
  union all select 'spaces', count(*)::int from public.app_spaces where workspace_id = '${ws}'
  union all select 'suborganizations', count(*)::int from public.app_suborganizations where workspace_id = '${ws}'
  union all select 'meetings', count(*)::int from public.app_meetings where workspace_id = '${ws}'
  union all select 'notes', count(*)::int from public.app_notes where workspace_id = '${ws}'
  union all select 'share_pages', count(*)::int from public.app_share_pages where workspace_id = '${ws}'
  union all select 'share_media', count(*)::int from public.app_share_page_media where workspace_id = '${ws}'
  union all select 'events', count(*)::int from public.app_events where workspace_id = '${ws}'
  union all select 'event_photos', count(*)::int from public.app_event_photos p join public.app_events e on e.id = p.event_id where e.workspace_id = '${ws}'
  union all select 'bundles', count(*)::int from public.app_reference_bundles where workspace_id = '${ws}'
  union all select 'record_links', count(*)::int from public.app_record_links where workspace_id = '${ws}'
  union all select 'drive_connections', count(*)::int from public.app_drive_connections where workspace_id = '${ws}'
  union all select 'tg_day_senders', count(*)::int from public.app_tg_day_senders where workspace_id = '${ws}'
  union all select 'calendar_connections', count(*)::int from public.app_google_calendar_connections where user_id = '${user}'
  union all select 'feature_locks', count(*)::int from public.app_feature_locks where user_id = '${user}'
  union all select 'feedback', count(*)::int from public.app_feedback where user_id = '${user}'
  union all select 'profiles', count(*)::int from public.app_profiles where user_id = '${user}'
  union all select 'collab_members', count(*)::int from public.app_collab_members where user_id = '${user}'
  union all select 'join_requests', count(*)::int from public.app_collab_join_requests where requester_user_id = '${user}'
  union all select 'join_attempts', count(*)::int from public.app_collab_join_attempts where user_id = '${user}'
  order by 1`;
