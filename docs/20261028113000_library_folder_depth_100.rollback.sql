begin;
-- 20261028113000_library_folder_depth_100의 짝 되돌리기. SQL Editor(폰 경로 C) 전용: 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다.
-- 함수 3개를 앞 단계 원문(3단 모양)으로 되돌리고 이번 기록 1행만 지운다. 폴더·자료 연결·휴지통 행은 한 줄도 지우거나 바꾸지 않는다.
-- 이미 4단 이상인 폴더가 하나라도 있으면(휴지통 안 폴더 포함) 아무것도 바꾸지 않고 멈춘다. 그때는 화면에서 그 폴더를 3단 안으로 옮긴 뒤 다시 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folders in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028113000' and name = 'library_folder_depth_100') <> 1 then
    raise exception 'LIBRARY_FOLDER_DEPTH_100_ROLLBACK_BLOCKED: migration record differs';
  end if;
  -- 4단 이상 폴더(위 폴더가 3개 이상)가 있으면 멈춘다. 휴지통에 있는 폴더도 센다(되돌리면 다시 보이므로).
  if exists (
    with recursive up(id, cur, lvl) as (
      select f.id, f.parent_id, 1 from public.app_library_folders f where f.parent_id is not null
      union all
      select up.id, p.parent_id, up.lvl + 1 from public.app_library_folders p join up on p.id = up.cur
       where p.parent_id is not null and up.lvl < 4
    )
    select 1 from up where up.lvl >= 3
  ) then
    raise exception 'LIBRARY_FOLDER_DEPTH_100_ROLLBACK_BLOCKED: folders deeper than 3 levels exist';
  end if;
end
$$;

-- 1) 폴더 넣기·옮기기 검사: 20261026170000_library_folders_free 원문(3단).
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
  ) then
    raise exception using errcode = '23514',
      message = 'LIB_FOLDER_SCOPE: a folder must stay in the same workspace as its parent';
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
revoke all on function private.app_library_folder_tree_guard() from public, anon;

-- 2) 휴지통 되돌리기: 20261027050000_trash_share_pages_db 원문(3단).
create or replace function public.app_trash_restore(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.app_spaces%rowtype;
  v_lf public.app_library_folders%rowtype;
  v_ws uuid;
  v_count integer;
  v_above integer;
  v_height integer;
  v_pdel timestamptz;
  v_proot uuid;
begin
  if p_kind = 'project' then
    select * into v_root from public.app_spaces s
     where s.id = p_id and s.deleted_at is not null and s.deleted_root_id = s.id
     for update;
    if not found or not private.app_is_workspace_owner(v_root.workspace_id) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    if exists (select 1 from public.app_spaces p where p.id = v_root.parent_id and p.deleted_at is not null) then
      raise exception using errcode = '23514', message = 'TRASH_PARENT_IN_TRASH';
    end if;
    update public.app_spaces s
       set deleted_at = null, deleted_root_id = null
     where s.deleted_root_id = v_root.id
       and s.workspace_id = v_root.workspace_id;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'project', 'id', v_root.id, 'restored', v_count);
  elsif p_kind = 'organization' then
    select o.workspace_id into v_ws from public.app_suborganizations o
     where o.id = p_id and o.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    update public.app_suborganizations o set deleted_at = null where o.id = p_id and o.deleted_at is not null;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'organization', 'id', p_id, 'restored', v_count);
  elsif p_kind = 'report' then
    select m.workspace_id into v_ws from public.app_meetings m
     where m.id = p_id and m.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    update public.app_meetings m set deleted_at = null where m.id = p_id and m.deleted_at is not null;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'report', 'id', p_id, 'restored', v_count);
  elsif p_kind = 'library_folder' then
    -- 폴더 묶음 전체를 되돌린다(맨 위 폴더 + 함께 들어간 하위 폴더). 안의 자료는 폴더 안에 그대로 있었으므로 폴더가 보이면 함께 돌아온다.
    select * into v_lf from public.app_library_folders f
     where f.id = p_id and f.deleted_at is not null and f.deleted_root_id = f.id
     for update;
    if not found or not private.app_is_workspace_owner(v_lf.workspace_id) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    -- 같은 작업공간의 폴더 옮기기·휴지통 이동·되돌리기를 한 번에 하나씩(순환·3단 검사와 같은 잠금).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_library_folders_tree:' || v_lf.workspace_id::text, 0));
    if exists (select 1 from public.app_library_folders p where p.id = v_lf.parent_id and p.deleted_at is not null) then
      raise exception using errcode = '23514', message = 'TRASH_PARENT_IN_TRASH';
    end if;
    -- 휴지통에 있는 동안 위 폴더가 더 깊은 곳으로 옮겨졌을 수 있으니 3단을 넘지 않는지 본다.
    with recursive up(id, lvl) as (
      select v_lf.parent_id, 1 where v_lf.parent_id is not null
      union all
      select f.parent_id, up.lvl + 1 from public.app_library_folders f join up on f.id = up.id
       where f.parent_id is not null and up.lvl < 6
    )
    select coalesce(pg_catalog.max(up.lvl), 0) into v_above from up;
    with recursive d(id, lvl) as (
      select v_lf.id, 1
      union all
      select f.id, d.lvl + 1 from public.app_library_folders f join d on f.parent_id = d.id
       where f.deleted_root_id = v_lf.id and d.lvl < 6
    )
    select pg_catalog.max(d.lvl) into v_height from d;
    if v_above + v_height > 3 then
      raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 3 levels';
    end if;
    update public.app_library_folders f
       set deleted_at = null, deleted_root_id = null
     where f.deleted_root_id = v_lf.id
       and f.workspace_id = v_lf.workspace_id;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'library_folder', 'id', v_lf.id, 'restored', v_count);
  elsif p_kind = 'note' then
    -- 표시만 비운다. 연결·첨부·본문은 지운 적이 없으므로 그대로 돌아온다(updated_at도 바꾸지 않는다).
    select n.workspace_id into v_ws from public.app_notes n
     where n.id = p_id and n.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    update public.app_notes n set deleted_at = null where n.id = p_id and n.deleted_at is not null;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'note', 'id', p_id, 'restored', v_count);
  elsif p_kind = 'share_page' then
    -- 표시만 비우고 넣기 전 상태(초안·게시·보관)를 그대로 되돌린다. 게시 상태였으면 같은 링크가 다시 열린다. updated_at은 바꾸지 않는다.
    select g.workspace_id into v_ws from public.app_share_pages g
     where g.id = p_id and g.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    update public.app_share_pages g
       set status = g.deleted_status, deleted_at = null, deleted_status = null
     where g.id = p_id and g.deleted_at is not null;
    get diagnostics v_count = row_count;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'share_page', 'id', p_id, 'restored', v_count);
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_restore(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_restore(text, uuid) to authenticated;

-- 3) 폴더 지우기(휴지통): 20261025180000_trash_library_folder_db 원문(10단 한도).
create or replace function private.app_trash_library_folder_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  -- 같은 작업공간의 폴더 옮기기(순환·3단 검사)와 한 번에 하나씩.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_library_folders_tree:' || old.workspace_id::text, 0));
  update public.app_library_folders f
     set deleted_at = pg_catalog.now(), deleted_root_id = old.id
   where f.deleted_at is null
     and f.workspace_id = old.workspace_id
     and f.id in (
       with recursive tree(id, path) as (
         select old.id, array[old.id]
         union all
         select c.id, t.path || c.id
         from public.app_library_folders c join tree t on c.parent_id = t.id
         where c.id <> all (t.path) and pg_catalog.array_length(t.path, 1) < 10
       )
       select tree.id from tree
     );
  return null;
end
$$;
revoke all on function private.app_trash_library_folder_before_delete() from public, anon, authenticated, service_role;

delete from supabase_migrations.schema_migrations where version = '20261028113000' and name = 'library_folder_depth_100';
commit;
