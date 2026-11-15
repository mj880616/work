begin;
-- NOTE-탐색기 1/2 DB(명진 요청 2026-10-28 09:24, 10:34 폴더 100단): 노트 폴더를 탐색기처럼 '폴더 안에 폴더'로.
-- 지금 노트 폴더는 노트 한 행의 metadata.folder 글자(한 단계)뿐이라 빈 폴더·폴더 안 폴더를 담을 곳이 없다.
-- 바꾸는 것: 새 표 1개(app_note_folders)와 그 표의 트리거 함수 2개. 기존 표·정책·권한·자료(app_notes 포함)는 한 줄도 바꾸지 않는다.
--  1) app_note_folders: 폴더(작업공간, 상위 폴더, 이름 1~40자, 순서). 노트가 어느 폴더에 있는지는 지금처럼 노트의 metadata에 적는다
--     (화면이 metadata.folder_id = 이 표의 id, metadata.folder = 폴더 이름을 함께 적는다 — 옛 화면·되돌리기 뒤에도 이름으로 보이게).
--  2) 지금 있는 폴더 이름(노트 metadata.folder)을 맨 위 폴더 행으로 한 번 옮겨 담는다(새 표에 넣기만, 노트는 고치지 않음).
--     folder_id가 없는 노트는 화면이 이름이 같은 맨 위 폴더에 있는 것으로 본다 → 노트 유실·이동 없음.
--  3) 트리거: 같은 작업공간·자기 안으로 넣기(돌고 도는 폴더) 금지·100단(folder-limits.mjs와 같은 숫자), 지우면 아래 폴더는 한 단 위로.
--     노트는 지우지 않는다(폴더를 지우기 전에 화면이 그 폴더 노트를 한 단 위로 옮긴다).
-- 권한: owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음. workspace_id는 고칠 수 없다.
-- 짝: docs/20261028170000_note_folders.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028170000')
     or to_regclass('public.app_note_folders') is not null
     or to_regprocedure('private.app_note_folder_tree_guard()') is not null
     or to_regprocedure('private.app_note_folder_lift()') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'metadata'
         and atttypid = 'jsonb'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_FOLDERS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 노트 폴더. 상위 폴더를 지우면(트리거가 먼저 한 단 위로 올림) 남은 것만 함께 지움, 작업공간을 지우면 함께 지움.
create table public.app_note_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  parent_id uuid references public.app_note_folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_note_folders_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_note_folders_parent_check check (parent_id is null or parent_id <> id)
);
create index app_note_folders_scope_idx on public.app_note_folders(workspace_id, parent_id, sort_order);
create index app_note_folders_parent_idx on public.app_note_folders(parent_id) where parent_id is not null;

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
-- 넣기 칸에 id가 있는 까닭: 폴더 지우기의 [되돌리기]가 같은 id로 다시 만들어 노트의 metadata.folder_id가 그대로 이어지게.
alter table public.app_note_folders enable row level security;
revoke all on table public.app_note_folders from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_folders to authenticated;
grant insert (id, workspace_id, parent_id, name, sort_order) on table public.app_note_folders to authenticated;
grant update (parent_id, name, sort_order) on table public.app_note_folders to authenticated;

create policy note_folders_owner_all on public.app_note_folders for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 상위 폴더 검사: 같은 작업공간, 자기 아래로 옮기기 금지, 100단까지(자료실 20261028113000과 같은 규칙·같은 숫자).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'NOTE_FOLDER_SCOPE:' / 'NOTE_FOLDER_CYCLE:' / 'NOTE_FOLDER_DEPTH:'.
create function private.app_note_folder_tree_guard()
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_note_folders_tree:' || new.workspace_id::text, 0));
  if not exists (
    select 1 from public.app_note_folders f
    where f.id = new.parent_id and f.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = '23514',
      message = 'NOTE_FOLDER_SCOPE: a folder must stay in the same workspace as its parent';
  end if;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514',
        message = 'NOTE_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it';
    end if;
    v_above := v_above + 1;
    if v_above >= 100 then
      raise exception using errcode = '23514', message = 'NOTE_FOLDER_DEPTH: folders are limited to 100 levels';
    end if;
    select f.parent_id into v_cursor from public.app_note_folders f where f.id = v_cursor;
  end loop;
  -- 옮기는 폴더를 1단으로 센 아래 단 수(하위가 없으면 1). 경로 배열로 돌고 도는 길을 막고 101단에서 멈춘다.
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select f.id, d.lvl + 1, d.path || f.id
    from public.app_note_folders f join d on f.parent_id = d.id
    where f.id <> all(d.path) and d.lvl < 101
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 100 then
    raise exception using errcode = '23514', message = 'NOTE_FOLDER_DEPTH: folders are limited to 100 levels';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_note_folder_tree_guard() from public, anon, authenticated, service_role;

-- 폴더를 지우면 안의 폴더는 한 단 위로(맨 위 폴더였으면 맨 위로). 다른 삭제(작업공간 삭제 등)에 딸려 지워질 때는 아무것도 하지 않는다.
create function private.app_note_folder_lift()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $lift$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_note_folders set parent_id = old.parent_id
    where parent_id = old.id;
  return old;
end
$lift$;
revoke all on function private.app_note_folder_lift() from public, anon, authenticated, service_role;

create trigger app_note_folders_tree_guard
before insert or update of parent_id on public.app_note_folders
for each row execute function private.app_note_folder_tree_guard();

create trigger app_note_folders_lift_on_delete
before delete on public.app_note_folders
for each row execute function private.app_note_folder_lift();

-- 지금 있는 폴더 이름(노트 metadata.folder, 한 단계)을 맨 위 폴더로 한 번 옮겨 담는다. 노트 행은 읽기만 한다.
-- 이름 규칙(1~40자, 앞뒤 공백·제어문자 없음)에 맞는 이름만. 같은 작업공간 같은 이름은 한 번만, 이름 차례로 순서를 매긴다.
insert into public.app_note_folders (workspace_id, name, sort_order)
select s.workspace_id, s.name, (row_number() over (partition by s.workspace_id order by s.name) * 1024)::integer
from (
  select distinct n.workspace_id, n.metadata ->> 'folder' as name
  from public.app_notes n
  where n.kind = 'note'
    and jsonb_typeof(n.metadata -> 'folder') = 'string'
    and char_length(n.metadata ->> 'folder') between 1 and 40
    and n.metadata ->> 'folder' = btrim(n.metadata ->> 'folder')
    and n.metadata ->> 'folder' !~ '[[:cntrl:]]'
) s;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, workspace_id 고칠 수 없음, 트리거 2개,
-- 옮겨 담은 폴더 수 = 노트에 적힌 서로 다른 이름 수. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_note_folders'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_note_folders'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_note_folders'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_note_folders', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_note_folders', 'truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_note_folders', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_folders', 'id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_folders', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_folders', 'name', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_note_folders'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_note_folders'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_note_folders'::regclass and not tgisinternal) <> 2
     or (select count(*) from public.app_note_folders) <> (
         select count(*) from (select distinct n.workspace_id, n.metadata ->> 'folder'
           from public.app_notes n
           where n.kind = 'note' and jsonb_typeof(n.metadata -> 'folder') = 'string'
             and char_length(n.metadata ->> 'folder') between 1 and 40
             and n.metadata ->> 'folder' = btrim(n.metadata ->> 'folder')
             and n.metadata ->> 'folder' !~ '[[:cntrl:]]') s) then
    raise exception 'NOTE_FOLDERS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028170000', 'note_folders', array['NOTE-탐색기: app_note_folders (owner RLS, tree guard 100 levels, lift on delete) + seed root folders from app_notes metadata.folder names']);
commit;
