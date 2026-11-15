begin;
-- FOLDER-순서·색 ③-2 DB (S49-50, 설계 docs/design/folder-color-order.md 2-1·2-2·4절, 명진 결정 11/04 16:19: 8색 그대로·안 고른 폴더는 지금 모양 그대로).
-- [파일]·사진 폴더(원드라이브·구글 드라이브)와 앨범이 노트·자료실과 같은 색(1~8)·순서를 서버에 남긴다(폰·PC 같음, 기기 저장 없음).
-- 무엇:
--  1) 새 표 public.app_folder_prefs: 클라우드 폴더 하나 = 한 줄(source 'od'|'gd'|'phone', folder_key = 그 출처의 폴더 id, color 1~8 또는 null, sort_order 정수 또는 null).
--     RLS 켬. authenticated는 읽기만(작업공간 소유자 정책 하나). anon·PUBLIC·service_role 권한 없음. 쓰기는 아래 함수로만.
--  2) public.app_photo_tags(앨범)에 칸 2개: color smallint null(null 또는 1~8), sort_order integer not null default 0(0 = 아직 순서를 안 정함 → 이름순).
--  3) 새 함수 2개(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만, 둘 다 private.app_is_workspace_owner로 소유자만):
--     public.app_folder_prefs_apply(p_workspace_id uuid, p_source text, p_items jsonb) -> jsonb {ok, count}
--       items = [{k: 폴더 id, c: 색(있을 때만 바꿈, null=기본), o: 순서(있을 때만 바꿈, null=순서 없음)}] 200줄까지. 줄이 없으면 만든다.
--     public.app_photo_tag_look_apply(p_workspace_id uuid, p_items jsonb) -> jsonb {ok, count}
--       items = [{id: 앨범 id, c: 색, o: 순서}] 200줄까지. 그 작업공간의 앨범만 바꾼다(이름·대표 사진·연결은 건드리지 않음).
-- 설계와 다른 점(한 줄): 설계 2-1·2-2의 '열 권한(update color/sort_order)·insert/update 권한'은 승인형 DB workflow 확장 규칙(기존 표 권한 추가 거절)과
--   ③-1(자료실)과의 일관성 때문에 표 쓰기 권한 없이 owner 판정 함수로만 쓴다. 기존 표 app_photo_tags의 권한·정책·RLS는 그대로다.
-- 안 하는 것: 기존 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체, 클라우드의 실제 폴더 이름·순서 변경(Web2 안 꾸미기뿐).
-- 짝: docs/20261104223000_folder_look_prefs.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104223000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029150000' and name = 'photo_tags') <> 1
     or to_regclass('public.app_photo_tags') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_folder_prefs') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_photo_tags') and attname in ('color', 'sort_order') and not attisdropped)
     or to_regprocedure('public.app_folder_prefs_apply(uuid,text,jsonb)') is not null
     or to_regprocedure('public.app_photo_tag_look_apply(uuid,jsonb)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_photo_tags') and relrowsecurity)
     or exists (select 1 from pg_class where oid = to_regclass('public.app_photo_tags') and relacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'FOLDER_LOOK_PREFS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_folder_prefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  folder_key text not null,
  color smallint,
  sort_order integer,
  updated_at timestamptz not null default now(),
  constraint app_folder_prefs_source_check check (source in ('od', 'gd', 'phone')),
  constraint app_folder_prefs_key_check check (char_length(folder_key) between 1 and 300),
  constraint app_folder_prefs_color_check check (color is null or color between 1 and 8),
  constraint app_folder_prefs_unique unique (workspace_id, source, folder_key)
);

alter table public.app_folder_prefs enable row level security;
revoke all on table public.app_folder_prefs from public, anon, authenticated, service_role;
grant select on table public.app_folder_prefs to authenticated;
create policy folder_prefs_owner_select on public.app_folder_prefs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

alter table public.app_photo_tags add column color smallint;
alter table public.app_photo_tags add column sort_order integer not null default 0;
alter table public.app_photo_tags add constraint app_photo_tags_color_check check (color is null or color between 1 and 8);

create function public.app_folder_prefs_apply(p_workspace_id uuid, p_source text, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  n integer := 0;
  hit integer;
  key text;
  has_c boolean;
  has_o boolean;
  col smallint;
  ord integer;
begin
  if p_workspace_id is null or p_source is null or p_source not in ('od', 'gd', 'phone')
     or p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) < 1 or pg_catalog.jsonb_array_length(p_items) > 200 then
    raise exception using errcode = '22023', message = 'FOLDER_PREFS_ARGS';
  end if;
  if not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'FOLDER_PREFS_FORBIDDEN';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(item) <> 'object' or pg_catalog.jsonb_typeof(item -> 'k') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'FOLDER_PREFS_ARGS';
    end if;
    key := item ->> 'k';
    if pg_catalog.char_length(key) < 1 or pg_catalog.char_length(key) > 300 then
      raise exception using errcode = '22023', message = 'FOLDER_PREFS_ARGS';
    end if;
    has_c := item ? 'c';
    has_o := item ? 'o';
    col := null;
    ord := null;
    if has_c then
      if pg_catalog.jsonb_typeof(item -> 'c') = 'number' and (item ->> 'c') ~ '^[1-8]$' then col := (item ->> 'c')::smallint;
      elsif pg_catalog.jsonb_typeof(item -> 'c') <> 'null' then raise exception using errcode = '22023', message = 'FOLDER_PREFS_ARGS';
      end if;
    end if;
    if has_o then
      if pg_catalog.jsonb_typeof(item -> 'o') = 'number' and (item ->> 'o') ~ '^-?[0-9]{1,9}$' then ord := (item ->> 'o')::integer;
      elsif pg_catalog.jsonb_typeof(item -> 'o') <> 'null' then raise exception using errcode = '22023', message = 'FOLDER_PREFS_ARGS';
      end if;
    end if;
    update public.app_folder_prefs t
       set color = case when has_c then col else t.color end,
           sort_order = case when has_o then ord else t.sort_order end,
           updated_at = pg_catalog.now()
     where t.workspace_id = p_workspace_id and t.source = p_source and t.folder_key = key;
    get diagnostics hit = row_count;
    if hit = 0 then
      insert into public.app_folder_prefs (workspace_id, source, folder_key, color, sort_order)
      values (p_workspace_id, p_source, key, col, ord);
    end if;
    n := n + 1;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'count', n);
end
$$;

create function public.app_photo_tag_look_apply(p_workspace_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  n integer := 0;
  hit integer;
  tag uuid;
  has_c boolean;
  has_o boolean;
  col smallint;
  ord integer;
begin
  if p_workspace_id is null or p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) < 1 or pg_catalog.jsonb_array_length(p_items) > 200 then
    raise exception using errcode = '22023', message = 'PHOTO_TAG_LOOK_ARGS';
  end if;
  if not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'PHOTO_TAG_LOOK_FORBIDDEN';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(item) <> 'object' or (item ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'PHOTO_TAG_LOOK_ARGS';
    end if;
    tag := (item ->> 'id')::uuid;
    has_c := item ? 'c';
    has_o := item ? 'o';
    col := null;
    ord := 0;
    if has_c then
      if pg_catalog.jsonb_typeof(item -> 'c') = 'number' and (item ->> 'c') ~ '^[1-8]$' then col := (item ->> 'c')::smallint;
      elsif pg_catalog.jsonb_typeof(item -> 'c') <> 'null' then raise exception using errcode = '22023', message = 'PHOTO_TAG_LOOK_ARGS';
      end if;
    end if;
    if has_o then
      if pg_catalog.jsonb_typeof(item -> 'o') = 'number' and (item ->> 'o') ~ '^-?[0-9]{1,9}$' then ord := (item ->> 'o')::integer;
      else raise exception using errcode = '22023', message = 'PHOTO_TAG_LOOK_ARGS';
      end if;
    end if;
    update public.app_photo_tags t
       set color = case when has_c then col else t.color end,
           sort_order = case when has_o then ord else t.sort_order end
     where t.id = tag and t.workspace_id = p_workspace_id;
    get diagnostics hit = row_count;
    n := n + hit;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'count', n);
end
$$;

revoke all on function public.app_folder_prefs_apply(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_folder_prefs_apply(uuid, text, jsonb) to authenticated;
revoke all on function public.app_photo_tag_look_apply(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_photo_tag_look_apply(uuid, jsonb) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_photo_tags'::regclass and attname = 'color' and not attisdropped and atttypid = 'int2'::regtype and not attnotnull)
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_photo_tags'::regclass and attname = 'sort_order' and not attisdropped and atttypid = 'int4'::regtype and attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_photo_tags'::regclass and conname = 'app_photo_tags_color_check' and contype = 'c' and convalidated) <> 1
     or not exists (select 1 from pg_class where oid = 'public.app_folder_prefs'::regclass and relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_folder_prefs'::regclass) <> 1
     or has_any_column_privilege('anon', 'public.app_folder_prefs'::regclass, 'select,insert,update,references')
     or has_table_privilege('authenticated', 'public.app_folder_prefs', 'insert,update,delete')
     or not has_table_privilege('authenticated', 'public.app_folder_prefs', 'select')
     or has_column_privilege('authenticated', 'public.app_photo_tags'::regclass, 'color', 'insert,update')
     or has_column_privilege('authenticated', 'public.app_photo_tags'::regclass, 'sort_order', 'insert,update')
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_folder_prefs_apply(uuid,text,jsonb)'), to_regprocedure('public.app_photo_tag_look_apply(uuid,jsonb)'))
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 2
     or not has_function_privilege('authenticated', 'public.app_folder_prefs_apply(uuid,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_photo_tag_look_apply(uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_folder_prefs_apply(uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_photo_tag_look_apply(uuid,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.app_folder_prefs_apply(uuid,text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.app_photo_tag_look_apply(uuid,jsonb)', 'execute') then
    raise exception 'FOLDER_LOOK_PREFS_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104223000', 'folder_look_prefs', array['FOLDER color/order 3-2: new table app_folder_prefs (owner select policy only, RLS on, no write grants); app_photo_tags adds nullable smallint color (null or 1..8) and sort_order integer not null default 0; SECURITY DEFINER functions app_folder_prefs_apply(uuid,text,jsonb) and app_photo_tag_look_apply(uuid,jsonb) (empty search_path, authenticated execute only, workspace owner only); no existing policy, table grant, trigger or RLS change']);
commit;
