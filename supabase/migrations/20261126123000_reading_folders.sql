begin;
-- S70-83 READ-저장한글폴더(사용자 결정 2026-11-26 — 저장한 글에 폴더). 저장한 글을 폴더로 나눠 담는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 같은 목적 표 재사용 검토(PR 본문에 같은 내용):
--  · app_note_folders(노트)·app_library_folders(자료실)는 그 화면 줄(노트·자료)만 담는 표이고 지우기·되돌리기 규칙이 그 화면에 묶여 있다.
--  · app_news_folders(News 별표 폴더)는 운영자 기능 키 'outside'로 서버가 받는 News 표 묶음이라, 모든 사람의 저장한 글 폴더로 쓰면 News 문을 넓히게 된다.
--  그래서 저장한 글 전용 폴더 표 하나를 새로 두고(작업공간마다, owner만), 저장한 글 한 줄에 '들어 있는 폴더' 칸 하나를 더한다.
--
--  1) public.app_reading_folders(새): 폴더(작업공간, 상위 폴더, 이름 1~40자, 순서). 폴더 안 폴더(여러 단계, 2026-11-28 사용자 결정 "폴더 안에 폴더도 만들어").
--     상위 폴더 칸(parent_id)은 (parent_id, workspace_id) → (id, workspace_id) 외래 키라 같은 작업공간 폴더만 가리킨다.
--     트리거(private.app_reading_folder_tree_guard)가 자기 자신·자기 아래 폴더를 상위로 두기와 100단 넘기를 막는다(노트 폴더 20261028170000과 같은 규칙·숫자).
--     폴더를 지우면 트리거(private.app_reading_folder_lift)가 안의 폴더를 한 단 위로 올린다(맨 위 폴더였으면 맨 위로) — 노트 폴더와 같은 규칙.
--     화면(authenticated): 자기 폴더 읽기·넣기(id·작업공간·상위·이름·순서 — id는 지운 폴더 되돌리기용)·상위·이름·순서 고치기·지우기. 작업공간은 못 고친다.
--  2) public.app_reading_items.folder_id(새 칸, 비어 있으면 '폴더 없음'): (folder_id, workspace_id) → app_reading_folders(id, workspace_id)
--     이라 같은 작업공간 폴더만 가리킨다. 폴더를 지우면 그 폴더의 글은 지우지 않고 칸만 비운다(on delete set null (folder_id)).
--     화면은 노트 폴더처럼 지우기 전에 그 폴더 글을 한 단 위 폴더로 먼저 옮긴다(서버 칸 비우기는 그 뒤에 남은 글의 안전장치).
--     화면(authenticated)은 이 칸만 칸 단위로 고칠 수 있다(기존 칸 권한 그대로).
--
-- 권한: 새 표 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만). anon·PUBLIC·service_role 권한 없음. 공유(app_collab_*) 대상 아님.
-- 함수: 새 표 트리거용 private 함수 2개(security invoker, search_path 고정, 모든 역할 실행권 회수 — 화면이 부르지 않음).
-- 안 하는 것: 기존 칸·권한·정책·트리거·함수 변경, 기존 줄 변경(새 칸은 모두 비어 있음 = 폴더 없음), 확장 추가, rtw_* 객체, 저장한 글 표 트리거.
-- 되돌리기: docs/20261126123000_reading_folders.rollback.sql(SQL Editor 전용: 새 칸·새 표·새 함수 2개 삭제. 폴더가 하나라도 있으면 지우지 않고 멈춤).
-- 짝: docs/20261126123000_reading_folders.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126123000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122100000' and name = 'reading_items') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_reading_items') is null
     or to_regclass('public.app_reading_folders') is not null
     or to_regprocedure('private.app_reading_folder_tree_guard()') is not null
     or to_regprocedure('private.app_reading_folder_lift()') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_reading_items') and attname = 'folder_id' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_reading_items') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and attnotnull and not attisdropped)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_reading_items') and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'READING_FOLDERS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 저장한 글 폴더. 상위 폴더를 지우면(트리거가 먼저 한 단 위로 올림) 남은 것만 함께 지움, 작업공간을 지우면 함께 지움.
create table public.app_reading_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  parent_id uuid,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_reading_folders_ws_unique unique (id, workspace_id),
  constraint app_reading_folders_parent_fkey foreign key (parent_id, workspace_id)
    references public.app_reading_folders(id, workspace_id) on delete cascade,
  constraint app_reading_folders_parent_check check (parent_id is null or parent_id <> id),
  constraint app_reading_folders_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]')
);
create index app_reading_folders_scope_idx on public.app_reading_folders(workspace_id, parent_id, sort_order);
create index app_reading_folders_parent_idx on public.app_reading_folders(parent_id) where parent_id is not null;

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_reading_folders enable row level security;
revoke all on table public.app_reading_folders from public, anon, authenticated, service_role;
grant select, delete on table public.app_reading_folders to authenticated;
grant insert (id, workspace_id, parent_id, name, sort_order) on table public.app_reading_folders to authenticated;
grant update (parent_id, name, sort_order) on table public.app_reading_folders to authenticated;

create policy reading_folders_owner_all on public.app_reading_folders for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 상위 폴더 검사: 같은 작업공간, 자기 자신·자기 아래로 옮기기 금지, 100단까지(노트 폴더 20261028170000과 같은 규칙·같은 숫자).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'READING_FOLDER_SCOPE:' / 'READING_FOLDER_CYCLE:' / 'READING_FOLDER_DEPTH:'.
create function private.app_reading_folder_tree_guard()
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_reading_folders_tree:' || new.workspace_id::text, 0));
  if not exists (
    select 1 from public.app_reading_folders f
    where f.id = new.parent_id and f.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = '23514',
      message = 'READING_FOLDER_SCOPE: a folder must stay in the same workspace as its parent';
  end if;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514',
        message = 'READING_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it';
    end if;
    v_above := v_above + 1;
    if v_above >= 100 then
      raise exception using errcode = '23514', message = 'READING_FOLDER_DEPTH: folders are limited to 100 levels';
    end if;
    select f.parent_id into v_cursor from public.app_reading_folders f where f.id = v_cursor;
  end loop;
  -- 옮기는 폴더를 1단으로 센 아래 단 수(하위가 없으면 1). 경로 배열로 돌고 도는 길을 막고 101단에서 멈춘다.
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select f.id, d.lvl + 1, d.path || f.id
    from public.app_reading_folders f join d on f.parent_id = d.id
    where f.id <> all(d.path) and d.lvl < 101
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 100 then
    raise exception using errcode = '23514', message = 'READING_FOLDER_DEPTH: folders are limited to 100 levels';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_reading_folder_tree_guard() from public, anon, authenticated, service_role;

-- 폴더를 지우면 안의 폴더는 한 단 위로(맨 위 폴더였으면 맨 위로). 다른 삭제(작업공간 삭제 등)에 딸려 지워질 때는 아무것도 하지 않는다.
create function private.app_reading_folder_lift()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $lift$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_reading_folders set parent_id = old.parent_id
    where parent_id = old.id;
  return old;
end
$lift$;
revoke all on function private.app_reading_folder_lift() from public, anon, authenticated, service_role;

create trigger app_reading_folders_tree_guard
before insert or update of parent_id on public.app_reading_folders
for each row execute function private.app_reading_folder_tree_guard();

create trigger app_reading_folders_lift_on_delete
before delete on public.app_reading_folders
for each row execute function private.app_reading_folder_lift();

-- 저장한 글이 들어 있는 폴더(비어 있으면 폴더 없음). 같은 작업공간 폴더만, 폴더를 지우면 이 칸만 비운다(글은 그대로).
alter table public.app_reading_items
  add column folder_id uuid;
alter table public.app_reading_items
  add constraint app_reading_items_folder_fkey foreign key (folder_id, workspace_id)
    references public.app_reading_folders(id, workspace_id) on delete set null (folder_id);
create index app_reading_items_folder_idx on public.app_reading_items(folder_id) where folder_id is not null;
grant update (folder_id) on table public.app_reading_items to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126123000', 'reading_folders', array['S70-83 READ saved-post folders: new app_reading_folders with nested parent_id (same-workspace key, tree guard and lift-on-delete invoker triggers; owner RLS one policy, authenticated select/delete, insert id/workspace_id/parent_id/name/sort_order, update parent_id/name/sort_order, no anon/PUBLIC/service_role), app_reading_items adds folder_id (FK with workspace_id to app_reading_folders, on delete set null folder_id only, update grant on that column only); no existing column, grant, policy, trigger or row change']);
commit;
