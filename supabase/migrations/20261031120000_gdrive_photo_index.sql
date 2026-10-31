begin;
-- S46-24 사진 출처 구글 드라이브 ① DB (명진 G1 2026-10-31: 드라이브 읽기·쓰기 권한). 설계: docs/design/photo-gdrive-permission.md 6절 1번.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_gdrive_folders: 사진 화면에서 켠 구글 드라이브 폴더(항목 id·이름·부모 id)와 켜짐 여부. 처음엔 꺼짐(명진이 켜기 전엔 섞이지 않음).
--     Drive 전체 폴더를 미리 받지 않는다: 폴더 목록은 Edge gdrive-photos가 그때그때 Drive에서 읽고, 켠 폴더만 여기에 남는다.
--  2) app_gdrive_photos: 켠 폴더 안 사진·동영상 한 장 = 항목 id·파일 이름·종류(그림/동영상)·찍은 시각·추정 여부·서울 날짜·부모 폴더 id.
--     원본 사진·썸네일은 저장하지 않는다(목록 사본).
--  3) app_gdrive_sync: 작업공간마다 1행. 마지막으로 받은 시각(synced_at)과 동시에 두 번 받지 않게 잠금 시각(index_lock_until).
--  4) 운영자 기능 키에 'gdrive_photos'를 더한다(검사 지우고 같은 이름으로 다시 만듦). 허용 행은 '통화(calls)가 허용된 작업공간이
--     정확히 하나이고 그 작업공간이 Drive 연결 작업공간(kptu-work)일 때'만 그 작업공간에 1행 넣는다. 고정 id·이름·메일을 쓰지 않는다.
--     Drive 토큰은 프로젝트 전체에 1개(명진 계정)라 다른 작업공간에서 이 출처를 켜면 명진 Drive가 보이므로, 서버가 이 키로 막는다.
--
-- 권한: 원드라이브 색인 표(20261028010000)와 같은 경계. 새 표 3개 RLS 켬, 정책 없음, anon·authenticated·PUBLIC 권한 없음(화면은 직접 못 읽음).
--   읽고 쓰는 곳은 Edge 함수 gdrive-photos(service_role) 하나뿐이고, 함수가 로그인한 작업공간 owner·운영자 기능·Drive 연결 주인을 확인한 뒤 그 작업공간 행만 다룬다.
--   새 표 service_role 권한은 select·insert·update·delete 넷뿐(upsert에 update 필요). 기존 표(app_operator_features 포함)에는 권한을 더하지 않는다.
-- 안 하는 것: 함수·트리거·정책·기존 칸·기존 권한·기존 행 변경. Drive 파일 자체는 이 DB가 바꾸지 않는다(쓰기는 Edge가 사용자가 누를 때만).
-- 짝: docs/20261031120000_gdrive_photo_index.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_gdrive_folders') is not null
     or to_regclass('public.app_gdrive_photos') is not null
     or to_regclass('public.app_gdrive_sync') is not null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ 'telegram' and pg_get_constraintdef(oid) !~ 'gdrive_photos') <> 1
     or exists (select 1 from public.app_operator_features where feature not in ('calls', 'telegram')) then
    raise exception 'GDRIVE_INDEX_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1
     or (select count(*) from public.app_operator_features f join public.app_workspaces w on w.id = f.workspace_id
         where f.feature = 'calls' and w.slug = 'kptu-work') <> 1 then
    raise exception 'GDRIVE_INDEX_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'gdrive_photos' from public.app_operator_features f where f.feature = 'calls';

create table public.app_gdrive_sync (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  synced_at timestamptz,
  index_lock_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.app_gdrive_folders (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  item_id text not null,
  parent_id text,
  name text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_id),
  constraint app_gdrive_folders_id_check check (item_id ~ '^[A-Za-z0-9_-]{1,200}$'
    and (parent_id is null or parent_id ~ '^[A-Za-z0-9_-]{1,200}$')),
  constraint app_gdrive_folders_name_check check (char_length(name) between 1 and 400)
);
create index app_gdrive_folders_parent_idx on public.app_gdrive_folders(workspace_id, parent_id);

create table public.app_gdrive_photos (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  item_id text not null,
  parent_id text not null,
  name text not null,
  video boolean not null default false,
  size_bytes bigint,
  taken_at timestamptz not null,
  approx boolean not null default false,
  taken_day date not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_id),
  constraint app_gdrive_photos_id_check check (item_id ~ '^[A-Za-z0-9_-]{1,200}$' and parent_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  constraint app_gdrive_photos_name_check check (char_length(name) between 1 and 400),
  constraint app_gdrive_photos_size_check check (size_bytes is null or size_bytes >= 0)
);
create index app_gdrive_photos_day_idx on public.app_gdrive_photos(workspace_id, taken_day);
create index app_gdrive_photos_parent_idx on public.app_gdrive_photos(workspace_id, parent_id);

alter table public.app_gdrive_sync enable row level security;
alter table public.app_gdrive_folders enable row level security;
alter table public.app_gdrive_photos enable row level security;
revoke all on table public.app_gdrive_sync from public, anon, authenticated, service_role;
revoke all on table public.app_gdrive_folders from public, anon, authenticated, service_role;
revoke all on table public.app_gdrive_photos from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.app_gdrive_sync to service_role;
grant select, insert, update, delete on table public.app_gdrive_folders to service_role;
grant select, insert, update, delete on table public.app_gdrive_photos to service_role;

-- 사후 확인: 새 표 셋 RLS 켜짐·정책 없음·anon·authenticated·PUBLIC 권한 없음·service_role은 넷만,
-- 운영자 표는 RLS 켜짐·정책 없음·권한 없음 그대로, gdrive_photos 행은 calls 행과 같은 작업공간 1행. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_gdrive_sync'::regclass, 'public.app_gdrive_folders'::regclass, 'public.app_gdrive_photos'::regclass,
                           'public.app_operator_features'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_policy where polrelid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl is not null)
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('service_role', t, 'truncate,references,trigger') then
      raise exception 'GDRIVE_INDEX_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.app_gdrive_sync', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_gdrive_folders', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_gdrive_photos', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete')
     or (select count(*) from public.app_operator_features where feature = 'gdrive_photos') <> 1
     or (select count(*) from public.app_operator_features g join public.app_operator_features c
           on c.workspace_id = g.workspace_id and c.feature = 'calls' where g.feature = 'gdrive_photos') <> 1 then
    raise exception 'GDRIVE_INDEX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261031120000', 'gdrive_photo_index', array['S46-24 사진 출처 구글 드라이브: app_gdrive_folders + app_gdrive_photos + app_gdrive_sync (service_role only, no authenticated/anon access) + operator feature gdrive_photos for the Drive-connected operator workspace']);
commit;
