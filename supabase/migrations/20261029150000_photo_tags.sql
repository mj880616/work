begin;
-- PHOTO-사진메뉴 ②단계 DB: 앨범(#태그). 사진 메뉴 설계(docs/design/photo-menu.md 2.2절 ②)의 새 표 2개.
--   1) app_photo_tags: 앨범 하나 = 태그 하나(이름·대표 사진). 이름은 1~40자, '#'·공백 없음, 한 작업공간 안에서 대소문자 무시 중복 불가.
--   2) app_photo_tag_items: 어느 사진이 어느 앨범에 들었는지만 적는다(출처 onedrive·upload + 사진 열쇠 + 찍은 날). 사진 파일은 여기 없다.
-- 태그는 Web2 서버에만 있고 원드라이브 파일은 건드리지 않는다. 앨범 지우기 = 태그 행과 그 연결 행만 지운다(사진은 그대로).
-- 노트 해시태그와는 입력 모양만 같고 저장은 따로다(섞지 않음).
-- 권한: 새 표 2개만. 기존 표의 권한·정책·칸은 건드리지 않는다.
--   authenticated: 작업공간 소유자(private.app_is_workspace_owner)만, 정책 하나씩(app_diary_stars와 같은 모양).
--     tags = 읽기·넣기(작업공간·이름·대표)·고치기(이름·대표·고친 시각)·지우기, items = 읽기·넣기·지우기(고치기 없음).
--   연결 행의 작업공간은 태그의 작업공간과 같아야 한다(두 칸 외래 키). 다른 작업공간 태그에 사진을 넣을 수 없다.
--   anon·PUBLIC·service_role: 없음(Edge는 이 표를 읽지 않는다. 앨범 사진 목록은 화면이 자기 연결 행의 열쇠를 library에 보낸다).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029150000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_diary_stars') is null
     or to_regclass('public.app_photo_tags') is not null
     or to_regclass('public.app_photo_tag_items') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'PHOTO_TAGS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_photo_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  cover_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_photo_tags_name_check check (char_length(name) between 1 and 40 and name !~ '[#[:space:]]'),
  constraint app_photo_tags_cover_check check (cover_key is null or char_length(cover_key) between 1 and 300),
  constraint app_photo_tags_id_workspace_unique unique (id, workspace_id)
);
create unique index app_photo_tags_name_idx on public.app_photo_tags(workspace_id, lower(name));

create table public.app_photo_tag_items (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  item_key text not null,
  taken_day date,
  created_at timestamptz not null default now(),
  constraint app_photo_tag_items_tag_fkey foreign key (tag_id, workspace_id) references public.app_photo_tags(id, workspace_id) on delete cascade,
  constraint app_photo_tag_items_source_check check (source in ('onedrive', 'upload')),
  constraint app_photo_tag_items_key_check check (char_length(item_key) between 1 and 300),
  constraint app_photo_tag_items_unique unique (tag_id, source, item_key)
);
create index app_photo_tag_items_ws_idx on public.app_photo_tag_items(workspace_id, source, item_key);

alter table public.app_photo_tags enable row level security;
alter table public.app_photo_tag_items enable row level security;
revoke all on table public.app_photo_tags from public, anon, authenticated, service_role;
revoke all on table public.app_photo_tag_items from public, anon, authenticated, service_role;

grant select, delete on table public.app_photo_tags to authenticated;
grant insert (workspace_id, name, cover_key) on table public.app_photo_tags to authenticated;
grant update (name, cover_key, updated_at) on table public.app_photo_tags to authenticated;
grant select, delete on table public.app_photo_tag_items to authenticated;
grant insert (tag_id, workspace_id, source, item_key, taken_day) on table public.app_photo_tag_items to authenticated;

create policy photo_tags_owner_all on public.app_photo_tags for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy photo_tag_items_owner_all on public.app_photo_tag_items for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: 두 표 모두 RLS 켜짐·authenticated 정책 하나, anon·PUBLIC·service_role 권한 없음,
-- tags는 workspace_id 고치기 불가, items는 고치기 불가. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_photo_tags'::regclass; i regclass := 'public.app_photo_tag_items'::regclass;
begin
  if (select count(*) from pg_class where oid in (t, i) and relrowsecurity) <> 2
     or exists (select 1 from pg_class where oid in (t, i) and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in (t, i) and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', i, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_any_column_privilege('anon', i, 'select,insert,update,references')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', i, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,insert,update,references')
     or has_any_column_privilege('service_role', i, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select,delete')
     or not has_table_privilege('authenticated', i, 'select,delete')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or has_table_privilege('authenticated', i, 'insert,update,truncate,references,trigger')
     or not has_column_privilege('authenticated', t, 'name', 'insert')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or not has_column_privilege('authenticated', t, 'name', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'id', 'update')
     or not has_column_privilege('authenticated', i, 'item_key', 'insert')
     or has_column_privilege('authenticated', i, 'id', 'insert')
     or has_any_column_privilege('authenticated', i, 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = i) <> 1
     or exists (select 1 from pg_policy where polrelid in (t, i) and not (polroles = array[to_regrole('authenticated')::oid])) then
    raise exception 'PHOTO_TAGS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029150000', 'photo_tags', array['PHOTO-사진메뉴 2단계: app_photo_tags + app_photo_tag_items (owner RLS, no anon/PUBLIC/service_role, items no update, same-workspace FK)']);
commit;
