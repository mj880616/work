begin;
-- JOURNAL-일기원드라이브 DB(1단계). 설계: docs/design/diary-onedrive.md.
-- 새 표 3개만 만든다. 기존 표·정책·함수·자료와 Google 연결 표는 바꾸지 않는다. 화면·Edge 변경 없음(Edge는 별도 PR, 배포는 이 migration 적용 뒤).
--   1) app_onedrive_connections: 원드라이브 연결 1줄(로그인 사용자별). 토큰·고른 폴더·동기화 위치·로그인 진행 중 값.
--      Google 연결(app_google_calendar_connections)과 같은 구조(사용자당 한 줄, access/refresh 토큰, 만료 시각)이며 서버(service_role)만 읽고 쓴다.
--      authenticated·anon·PUBLIC에는 어떤 권한도 주지 않는다(정책 0개 = 화면에서 직접 읽을 길 없음). 화면은 Edge `onedrive-photos`의 status로만 상태를 본다.
--   2) app_onedrive_photos: 고른 폴더 사진의 "목록 색인"(항목 id·이름·찍은 날·크기). 사진 파일은 복사하지 않는다. 서버(service_role)만 읽고 쓴다.
--   3) app_diary_photo_stars: 일기 사진 별표(원드라이브 사진·직접 올린 사진 공통). 소유자만 읽고 쓰는 RLS, 화면이 직접 저장한다.
-- 안 하는 것: anon·PUBLIC 권한, RLS 약화, 함수·트리거, 기존 표 변경, rtw_* 객체.
-- 짝: docs/20261026090000_journal_onedrive.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026090000')
     or to_regclass('public.app_onedrive_connections') is not null
     or to_regclass('public.app_onedrive_photos') is not null
     or to_regclass('public.app_diary_photo_stars') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('auth.users') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'JOURNAL_ONEDRIVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 연결. 토큰 칸은 서버만 쓴다(길이 상한은 Microsoft 토큰이 길어도 넉넉하게).
-- oauth_*: 로그인 시작 때 넣고 콜백에서 한 번 쓰면 비운다(상태값은 해시만 저장, 10분 만료).
-- sync_cursor: Graph delta의 다음 쪽/최종 링크(서버 안에서만 쓴다). sync_done=false면 처음 읽는 중.
create table public.app_onedrive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  needs_reauth boolean not null default false,
  folder_id text,
  folder_name text,
  sync_cursor text,
  sync_done boolean not null default false,
  last_synced_at timestamptz,
  oauth_state_hash text,
  oauth_verifier text,
  oauth_expires_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_onedrive_conn_tokens_check check (
    (access_token is null or char_length(access_token) between 1 and 8192)
    and (refresh_token is null or char_length(refresh_token) between 1 and 8192)),
  constraint app_onedrive_conn_scope_check check (scope is null or (char_length(scope) <= 500 and scope !~ '[[:cntrl:]]')),
  constraint app_onedrive_conn_folder_check check (
    (folder_id is null) = (folder_name is null)
    and (folder_id is null or (folder_id ~ '^[A-Za-z0-9!_.:-]{1,255}$' and char_length(btrim(folder_name)) between 1 and 255 and folder_name !~ '[[:cntrl:]]'))),
  constraint app_onedrive_conn_cursor_check check (
    sync_cursor is null or (char_length(sync_cursor) <= 8192 and sync_cursor ~ '^https://graph\.microsoft\.com/[^[:space:][:cntrl:]]*$')),
  constraint app_onedrive_conn_oauth_check check (
    (oauth_state_hash is null) = (oauth_verifier is null)
    and (oauth_state_hash is null) = (oauth_expires_at is null)
    and (oauth_state_hash is null or (oauth_state_hash ~ '^[0-9a-f]{64}$' and oauth_verifier ~ '^[A-Za-z0-9._~-]{43,128}$')))
);

-- 2) 사진 색인. day_source: taken(사진 찍은 날, photo.takenDateTime) | file(파일 날짜, 찍은 날이 없을 때).
-- taken_at은 시간대 없는 값(날짜 규칙은 docs/design/diary-onedrive.md 3절). taken_day는 taken_at의 날짜와 같아야 한다.
create table public.app_onedrive_photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  taken_at timestamp not null,
  taken_day date not null,
  day_source text not null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  constraint app_onedrive_photos_item_check check (item_id ~ '^[A-Za-z0-9!_.:-]{1,255}$'),
  constraint app_onedrive_photos_day_check check (taken_day = taken_at::date and taken_day between date '1990-01-01' and date '2100-01-01'),
  constraint app_onedrive_photos_source_check check (day_source in ('taken', 'file')),
  constraint app_onedrive_photos_name_check check (char_length(name) between 1 and 400 and name !~ '[[:cntrl:]]'),
  constraint app_onedrive_photos_mime_check check (mime_type ~ '^image/[A-Za-z0-9.+-]{1,60}$'),
  constraint app_onedrive_photos_size_check check (size_bytes between 0 and 1099511627776)
);
create index app_onedrive_photos_day_idx on public.app_onedrive_photos(user_id, taken_day, taken_at);

-- 3) 별표. source: onedrive(원드라이브 항목 id) | upload(직접 올린 사진의 Drive 파일 id). day는 일기 화면의 날짜.
create table public.app_diary_photo_stars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  photo_ref text not null,
  day date not null,
  created_at timestamptz not null default now(),
  constraint app_diary_photo_stars_source_check check (source in ('onedrive', 'upload')),
  constraint app_diary_photo_stars_ref_check check (photo_ref ~ '^[A-Za-z0-9!_.:-]{1,255}$'),
  constraint app_diary_photo_stars_day_check check (day between date '1990-01-01' and date '2100-01-01'),
  constraint app_diary_photo_stars_key unique (workspace_id, source, photo_ref)
);
create index app_diary_photo_stars_day_idx on public.app_diary_photo_stars(workspace_id, day);

-- 4) 권한. 호스팅 기본 권한을 모두 걷어 낸 뒤 필요한 것만 준다.
alter table public.app_onedrive_connections enable row level security;
alter table public.app_onedrive_photos enable row level security;
alter table public.app_diary_photo_stars enable row level security;
revoke all on table public.app_onedrive_connections from public, anon, authenticated, service_role;
revoke all on table public.app_onedrive_photos from public, anon, authenticated, service_role;
revoke all on table public.app_diary_photo_stars from public, anon, authenticated, service_role;

-- 서버(Edge)만: 연결·색인. 화면(authenticated)에는 주지 않는다.
grant select, insert, update, delete on table public.app_onedrive_connections to service_role;
grant select, insert, update, delete on table public.app_onedrive_photos to service_role;

-- 소유자(authenticated): 별표 읽기·넣기·지우기. 고치기 없음(별표는 켜고 끄기뿐).
grant select, delete on table public.app_diary_photo_stars to authenticated;
grant insert (workspace_id, source, photo_ref, day) on table public.app_diary_photo_stars to authenticated;

create policy diary_photo_stars_owner_all on public.app_diary_photo_stars for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_onedrive_connections'::regclass, 'public.app_onedrive_photos'::regclass, 'public.app_diary_photo_stars'::regclass) and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_onedrive_connections'::regclass, 'public.app_onedrive_photos'::regclass, 'public.app_diary_photo_stars'::regclass) and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_onedrive_connections'::regclass, 'public.app_onedrive_photos'::regclass, 'public.app_diary_photo_stars'::regclass) and attacl::text ~ '(^|[{,])(anon)?=')
     or has_any_column_privilege('authenticated', 'public.app_onedrive_connections', 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'public.app_onedrive_photos', 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid in ('public.app_onedrive_connections'::regclass, 'public.app_onedrive_photos'::regclass)) <> 0
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_photo_stars'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_photo_stars'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'JOURNAL_ONEDRIVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026090000', 'journal_onedrive', array['JOURNAL-일기원드라이브: app_onedrive_connections, app_onedrive_photos (service_role only), app_diary_photo_stars (owner RLS), no anon']);
commit;
