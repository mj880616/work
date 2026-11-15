begin;
-- LIB-토글트리 ①: 자료실 전용 폴더(토글) 표 2개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다(docs/design/library-tree.md 3절).
-- app_library_folders: 폴더(작업공간, 프로젝트 틀(비면 '프로젝트 없음'), 상위 폴더, 이름, 순서).
-- app_library_folder_items: 자료 하나 → 폴더 하나. 행이 없으면 자료는 프로젝트 토글 바로 아래.
-- Drive 폴더·파일과 무관(이 표만 바뀜). 다른 화면은 이 표를 읽지 않는다.
-- owner만 읽고 쓴다(private.app_is_workspace_owner, 같은 작업공간 프로젝트는 기존 private.app_space_in_workspace).
-- anon·PUBLIC·service_role 권한 없음. 폴더의 workspace_id·project_id와 연결의 document_id·workspace_id는 고칠 수 없다.
-- 트리거 함수 2개(SECURITY INVOKER, search_path 빈칸, 실행권 전부 회수): 순환·깊이(3단)·같은 틀 검사, 지울 때 한 단 위로.
-- 짝: docs/20261022120000_library_folders.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120000')
     or to_regclass('public.app_library_folders') is not null
     or to_regclass('public.app_library_folder_items') is not null
     or to_regprocedure('private.app_library_folder_tree_guard()') is not null
     or to_regprocedure('private.app_library_folder_lift()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_documents') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_documents') and attname = 'project_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_documents') and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef) then
    raise exception 'LIBRARY_FOLDERS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 자료실 전용 폴더. 프로젝트를 지우면 폴더째 '프로젝트 없음'으로(project_id 비움), 작업공간을 지우면 함께 지움.
create table public.app_library_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  project_id uuid references public.app_spaces(id) on delete set null,
  parent_id uuid references public.app_library_folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_library_folders_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_library_folders_parent_check check (parent_id is null or parent_id <> id)
);
create index app_library_folders_scope_idx on public.app_library_folders(workspace_id, project_id, parent_id, sort_order);
create index app_library_folders_parent_idx on public.app_library_folders(parent_id) where parent_id is not null;

-- 자료 → 폴더. 자료 하나는 폴더 하나(기본키). 자료·폴더·작업공간을 지우면 연결도 지움(자료·Drive 파일은 남음).
create table public.app_library_folder_items (
  document_id uuid primary key references public.app_documents(id) on delete cascade,
  folder_id uuid not null references public.app_library_folders(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index app_library_folder_items_folder_idx on public.app_library_folder_items(folder_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_library_folders enable row level security;
alter table public.app_library_folder_items enable row level security;
revoke all on table public.app_library_folders from public, anon, authenticated, service_role;
revoke all on table public.app_library_folder_items from public, anon, authenticated, service_role;
grant select, delete on table public.app_library_folders to authenticated;
grant insert (workspace_id, project_id, parent_id, name, sort_order) on table public.app_library_folders to authenticated;
grant update (parent_id, name, sort_order) on table public.app_library_folders to authenticated;
grant select, delete on table public.app_library_folder_items to authenticated;
grant insert (document_id, folder_id, workspace_id) on table public.app_library_folder_items to authenticated;
grant update (folder_id) on table public.app_library_folder_items to authenticated;

create policy library_folders_owner_all on public.app_library_folders for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (project_id is null or private.app_space_in_workspace(project_id, workspace_id)));

-- 넣기·옮기기: 폴더와 자료가 같은 작업공간이고 같은 프로젝트 틀(둘 다 비어 있음 포함)이어야 한다.
create policy library_folder_items_owner_all on public.app_library_folder_items for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_library_folders f
      join public.app_documents d on d.id = app_library_folder_items.document_id
      where f.id = app_library_folder_items.folder_id
        and f.workspace_id = app_library_folder_items.workspace_id
        and d.workspace_id = app_library_folder_items.workspace_id
        and d.project_id is not distinct from f.project_id));

-- 상위 폴더 검사: 같은 작업공간·같은 프로젝트 틀, 자기 아래로 옮기기 금지, 폴더 3단까지.
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'LIB_FOLDER_SCOPE:' / 'LIB_FOLDER_CYCLE:' / 'LIB_FOLDER_DEPTH:'.
create function private.app_library_folder_tree_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_cursor uuid := new.parent_id;
  v_above integer := 0;
  v_height integer;
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  -- 같은 작업공간의 폴더 옮기기를 한 번에 하나씩: 동시에 서로를 아래로 옮겨 순환이 생기는 경우를 막는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_library_folders_tree:' || new.workspace_id::text, 0));
  if not exists (
    select 1 from public.app_library_folders f
    where f.id = new.parent_id and f.workspace_id = new.workspace_id
      and f.project_id is not distinct from new.project_id
  ) then
    raise exception using errcode = '23514',
      message = 'LIB_FOLDER_SCOPE: a folder must stay in the same workspace and project as its parent';
  end if;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514',
        message = 'LIB_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it';
    end if;
    v_above := v_above + 1;
    if v_above >= 3 then
      raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 3 levels';
    end if;
    select f.parent_id into v_cursor from public.app_library_folders f where f.id = v_cursor;
  end loop;
  -- 옮기는 폴더를 1단으로 센 아래 단 수(하위가 없으면 1). 4단까지만 따라간다.
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select f.id, d.lvl + 1, d.path || f.id
    from public.app_library_folders f join d on f.parent_id = d.id
    where f.id <> all(d.path) and d.lvl < 4
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 3 then
    raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 3 levels';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_library_folder_tree_guard() from public, anon, authenticated, service_role;

-- 폴더를 지우면 안의 폴더·자료는 한 단 위로. 맨 위 폴더였으면 자료는 폴더 밖(프로젝트 토글 바로 아래)으로.
-- 다른 삭제(작업공간 삭제 등)에 딸려 지워질 때는 아무것도 하지 않는다. 자료·Drive 파일은 지우지 않는다.
create function private.app_library_folder_lift()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $lift$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_library_folders set parent_id = old.parent_id
    where parent_id = old.id;
  -- 다른 화면에서 프로젝트가 바뀌어 틀이 어긋난 연결은 올리지 않고 지운다(그 자료는 이미 새 프로젝트 토글 바로 아래로 보임).
  delete from public.app_library_folder_items i
    where i.folder_id = old.id
      and (old.parent_id is null or not exists (
        select 1 from public.app_documents d
        where d.id = i.document_id and d.project_id is not distinct from old.project_id));
  update public.app_library_folder_items set folder_id = old.parent_id
    where folder_id = old.id and old.parent_id is not null;
  return old;
end
$lift$;
revoke all on function private.app_library_folder_lift() from public, anon, authenticated, service_role;

create trigger app_library_folders_tree_guard
before insert or update of parent_id on public.app_library_folders
for each row execute function private.app_library_folder_tree_guard();

create trigger app_library_folders_lift_on_delete
before delete on public.app_library_folders
for each row execute function private.app_library_folder_lift();

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 고칠 수 없는 칸 확인. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_library_folders'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_library_folder_items'::regclass)
     or exists (select 1 from pg_class where oid in ('public.app_library_folders'::regclass, 'public.app_library_folder_items'::regclass)
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_library_folders'::regclass, 'public.app_library_folder_items'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_column_privilege('authenticated', 'public.app_library_folders', 'project_id', 'update')
     or has_column_privilege('authenticated', 'public.app_library_folders', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_library_folder_items', 'document_id', 'update')
     or has_column_privilege('authenticated', 'public.app_library_folder_items', 'workspace_id', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_library_folders'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_folder_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_library_folders'::regclass, 'public.app_library_folder_items'::regclass)
         and polroles = array['authenticated'::regrole]::oid[]) <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.app_library_folders'::regclass and not tgisinternal) <> 2 then
    raise exception 'LIBRARY_FOLDERS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022120000', 'library_folders', array['LIB-토글트리: app_library_folders + app_library_folder_items (library-only folders), owner RLS, column grants, tree guard and lift-on-delete triggers (INVOKER), no anon/service_role']);
commit;
