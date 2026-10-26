begin;
-- 20261026170000_library_folders_free의 짝 되돌리기. 트리거 함수 2개와 자료 연결 정책을 이전 모양(같은 프로젝트 틀 검사)으로 되돌리고 이번 기록 1행만 지운다.
-- 폴더·자료 연결 행은 한 줄도 지우거나 바꾸지 않는다. 되돌린 뒤에는 이미 틀을 넘어선 폴더·연결이 남아 있을 수 있고, 화면은 그런 연결을 "폴더에 없는 것"으로 보고 프로젝트 맨 위에 보인다(데이터 그대로).
-- 되돌린 뒤 새로 넣거나 옮기는 것만 다시 같은 프로젝트 틀 안으로 제한된다.
-- 기존 정책 교체가 들어 있어 SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 정책 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folders, public.app_library_folder_items in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261026170000' and name = 'library_folders_free') <> 1 then
    raise exception 'LIBRARY_FOLDERS_FREE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if (select count(*) from pg_policy where polrelid = to_regclass('public.app_library_folder_items') and polname = 'library_folder_items_owner_all') <> 1 then
    raise exception 'LIBRARY_FOLDERS_FREE_ROLLBACK_BLOCKED: folder items policy differs';
  end if;
end
$$;

create or replace function private.app_library_folder_tree_guard()
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

create or replace function private.app_library_folder_lift()
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

drop policy library_folder_items_owner_all on public.app_library_folder_items;
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

delete from supabase_migrations.schema_migrations
  where version = '20261026170000' and name = 'library_folders_free';
commit;
