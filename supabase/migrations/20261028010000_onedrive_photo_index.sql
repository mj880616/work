begin;
-- JOURNAL-일기원드라이브 사진 색인 1단계 DB. 원드라이브 사진 '목록 정보'만 서버에 저장한다(원본 사진·썸네일은 저장하지 않음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_onedrive_folders: 고른 맨 위 폴더와 그 아래 하위 폴더 목록(항목 id·이름·부모 id)과 켜짐 여부(처음엔 켜짐).
--     경로는 저장하지 않는다: Graph delta 응답에는 경로가 오지 않고, 폴더를 옮기면 아래 폴더 경로가 모두 바뀌므로 부모 id로 이어서 계산한다.
--  2) app_onedrive_photos: 사진 한 장 = 항목 id·파일 이름·찍은 시각·추정 여부(찍은 시각이 없어 만든 시각을 씀)·서울 날짜·부모 폴더 id.
--  3) app_onedrive_connections에 색인 진행 칸 5개: delta_link(다음 변경 받기 주소), next_link(처음 색인 이어 받기 주소),
--     index_done_at(처음 색인 끝난 시각), synced_at(마지막으로 변경을 받은 시각), index_lock_until(동시에 두 번 받지 않게 잠금 시각).
--
-- 권한: 기존 연결 표와 같다. authenticated·anon·PUBLIC 권한 없음·정책 없음(화면은 직접 읽지 못함), RLS 켬.
--   읽고 쓰는 곳은 Edge 함수 onedrive-photos(service_role) 하나뿐이고, 함수가 로그인한 작업공간 소유자인지 확인한 뒤 그 작업공간 행만 다룬다.
--   새 표 2개의 service_role 권한은 select·insert·update·delete 넷뿐이다(여러 행을 한 번에 넣고 바꾸는 upsert에 update가 모든 칸에 필요).
--   연결 표의 service_role 권한은 새 칸 5개 고치기만 더한다(넣기 칸·workspace_id 고치기 권한은 그대로 없음).
-- 안 하는 것: 함수·트리거·기존 칸·기존 권한·기존 자료 변경. 화면·Edge가 아직 이 표를 쓰지 않으므로 지금 일기 화면은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028010000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261026140000')
     or to_regclass('public.app_onedrive_connections') is null
     or to_regclass('public.app_onedrive_folders') is not null
     or to_regclass('public.app_onedrive_photos') is not null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_onedrive_connections'::regclass and not attisdropped
         and attname in ('delta_link', 'next_link', 'index_done_at', 'synced_at', 'index_lock_until')) then
    raise exception 'ONEDRIVE_INDEX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_onedrive_connections
  add column delta_link text,
  add column next_link text,
  add column index_done_at timestamptz,
  add column synced_at timestamptz,
  add column index_lock_until timestamptz,
  add constraint app_onedrive_connections_links_check check (
    (delta_link is null or (char_length(delta_link) <= 4000 and delta_link like 'https://graph.microsoft.com/%'))
    and (next_link is null or (char_length(next_link) <= 4000 and next_link like 'https://graph.microsoft.com/%')));
grant update (delta_link, next_link, index_done_at, synced_at, index_lock_until)
  on table public.app_onedrive_connections to service_role;

create table public.app_onedrive_folders (
  workspace_id uuid not null references public.app_onedrive_connections(workspace_id) on delete cascade,
  item_id text not null,
  parent_id text,
  name text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_id),
  constraint app_onedrive_folders_id_check check (item_id ~ '^[A-Za-z0-9!_.-]{1,200}$'
    and (parent_id is null or parent_id ~ '^[A-Za-z0-9!_.-]{1,200}$')),
  constraint app_onedrive_folders_name_check check (char_length(name) between 1 and 400)
);
create index app_onedrive_folders_parent_idx on public.app_onedrive_folders(workspace_id, parent_id);

create table public.app_onedrive_photos (
  workspace_id uuid not null references public.app_onedrive_connections(workspace_id) on delete cascade,
  item_id text not null,
  parent_id text not null,
  name text not null,
  taken_at timestamptz not null,
  approx boolean not null default false,
  taken_day date not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_id),
  constraint app_onedrive_photos_id_check check (item_id ~ '^[A-Za-z0-9!_.-]{1,200}$' and parent_id ~ '^[A-Za-z0-9!_.-]{1,200}$'),
  constraint app_onedrive_photos_name_check check (char_length(name) between 1 and 400)
);
create index app_onedrive_photos_day_idx on public.app_onedrive_photos(workspace_id, taken_day);
create index app_onedrive_photos_parent_idx on public.app_onedrive_photos(workspace_id, parent_id);

alter table public.app_onedrive_folders enable row level security;
alter table public.app_onedrive_photos enable row level security;
revoke all on table public.app_onedrive_folders from public, anon, authenticated, service_role;
revoke all on table public.app_onedrive_photos from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.app_onedrive_folders to service_role;
grant select, insert, update, delete on table public.app_onedrive_photos to service_role;

-- 사후 확인: 세 표 RLS 켜짐, 정책 없음, anon·authenticated·PUBLIC 권한 없음, 새 표 service_role은 넷만(비우기·참조·트리거 없음),
-- 연결 표 service_role은 workspace_id 고치기·새 칸 넣기 권한 없음·새 칸 고치기 있음. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_onedrive_connections'::regclass, 'public.app_onedrive_folders'::regclass, 'public.app_onedrive_photos'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_policy where polrelid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('service_role', t, 'truncate,references,trigger') then
      raise exception 'ONEDRIVE_INDEX_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.app_onedrive_folders', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_onedrive_photos', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_onedrive_connections', 'insert,update')
     or has_column_privilege('service_role', 'public.app_onedrive_connections', 'workspace_id', 'update')
     or has_column_privilege('service_role', 'public.app_onedrive_connections', 'delta_link', 'insert')
     or not has_column_privilege('service_role', 'public.app_onedrive_connections', 'delta_link', 'update')
     or not has_column_privilege('service_role', 'public.app_onedrive_connections', 'index_lock_until', 'update') then
    raise exception 'ONEDRIVE_INDEX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028010000', 'onedrive_photo_index', array['JOURNAL-일기원드라이브 사진 색인: app_onedrive_folders + app_onedrive_photos (service_role only, no authenticated/anon access) + connection delta progress columns']);
commit;
