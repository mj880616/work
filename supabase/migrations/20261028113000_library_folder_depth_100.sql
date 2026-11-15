begin;
-- LIB-폴더100단 DB(명진 결정 2026-10-28 10:34): 자료실 폴더 단 제한을 3단에서 100단(사실상 무한)으로 올린다.
-- 바꾸는 것: 숫자만 바꾼 함수 3개(표·칸·정책·권한·트리거는 그대로, 새 표·새 칸·새 함수 없음).
--  1) private.app_library_folder_tree_guard(): 폴더 넣기·옮기기 검사. 3단 → 100단. 돌고 도는 폴더(자기 안으로 넣기) 막기·같은 작업공간·같은 잠금은 그대로.
--  2) public.app_trash_restore(text, uuid): 휴지통에서 폴더 되돌리기의 깊이 검사 3단 → 100단(위·아래 세는 한도 6 → 101). 다른 종류(프로젝트·담당조직·사업 보고·노트·공유 페이지)는 한 글자도 바꾸지 않는다.
--  3) private.app_trash_library_folder_before_delete(): 폴더 지우기(휴지통)가 아래 폴더를 함께 숨기는 한도 10단 → 101단(깊은 폴더가 휴지통에서 빠지지 않게).
-- 함수 정의는 앞 단계 원문을 그대로 쓰고 숫자·안내 주석만 바꾼다(소유자·security invoker/definer·search_path·실행권 그대로).
--  tree_guard: 20261026170000_library_folders_free, app_trash_restore: 20261027050000_trash_share_pages_db, before_delete: 20261025180000_trash_library_folder_db.
-- 깊이 계산 시간: 위로 세기는 기본키 조회 최대 100번, 아래로 세기는 그 폴더 아래 폴더 수만큼(경로 배열로 돌고 도는 길 차단, 101단에서 멈춤). 같은 작업공간 잠금 안에서 돈다.
-- 이미 만든 폴더·연결·휴지통 행은 한 줄도 바꾸지 않는다. 권한 확대 없음(anon·PUBLIC·service_role 실행권 없음 그대로, app_trash_restore는 authenticated만 그대로).
-- 서버 오류 글 앞머리 'LIB_FOLDER_DEPTH:'는 그대로라 화면은 적용 전·후 모두 같은 길로 알린다(숫자는 오류 글에서 읽음).
-- 짝: docs/20261028113000_library_folder_depth_100.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folders in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028113000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025180000' and name = 'trash_library_folder_db') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261026170000' and name = 'library_folders_free') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027050000' and name = 'trash_share_pages_db') <> 1
     or to_regclass('public.app_library_folders') is null
     -- 지금 함수 3개가 3단 모양이어야 한다.
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_tree_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%project_id%'
         and prosrc like '%if v_above >= 3 then%' and prosrc like '%d.lvl < 4%' and prosrc like '%if v_above + v_height > 3 then%') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_trash_restore(text,uuid)')
         and prosecdef and proconfig = array['search_path=""'] and prosrc like '%app_share_pages%'
         and prosrc like '%up.lvl < 6%' and prosrc like '%d.lvl < 6%' and prosrc like '%if v_above + v_height > 3 then%') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_trash_library_folder_before_delete()')
         and prosecdef and proconfig = array['search_path=""'] and prosrc like '%array_length(t.path, 1) < 10%') <> 1
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_library_folders') and not tgisinternal
         and tgname in ('app_library_folders_tree_guard', 'app_library_folders_lift_on_delete', 'app_library_folders_a_trash_before_delete')) <> 3
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null then
    raise exception 'LIBRARY_FOLDER_DEPTH_100_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 폴더 넣기·옮기기 검사: 3단 → 100단. 나머지는 20261026170000 원문 그대로.
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
    if v_above >= 100 then
      raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 100 levels';
    end if;
    select f.parent_id into v_cursor from public.app_library_folders f where f.id = v_cursor;
  end loop;
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select f.id, d.lvl + 1, d.path || f.id
    from public.app_library_folders f join d on f.parent_id = d.id
    where f.id <> all(d.path) and d.lvl < 101
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 100 then
    raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 100 levels';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_library_folder_tree_guard() from public, anon;

-- 2) 휴지통 되돌리기: 폴더 깊이 검사만 3단 → 100단. 나머지는 20261027050000 원문 그대로.
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
    -- 같은 작업공간의 폴더 옮기기·휴지통 이동·되돌리기를 한 번에 하나씩(순환·100단 검사와 같은 잠금).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_library_folders_tree:' || v_lf.workspace_id::text, 0));
    if exists (select 1 from public.app_library_folders p where p.id = v_lf.parent_id and p.deleted_at is not null) then
      raise exception using errcode = '23514', message = 'TRASH_PARENT_IN_TRASH';
    end if;
    -- 휴지통에 있는 동안 위 폴더가 더 깊은 곳으로 옮겨졌을 수 있으니 100단을 넘지 않는지 본다.
    with recursive up(id, lvl) as (
      select v_lf.parent_id, 1 where v_lf.parent_id is not null
      union all
      select f.parent_id, up.lvl + 1 from public.app_library_folders f join up on f.id = up.id
       where f.parent_id is not null and up.lvl < 101
    )
    select coalesce(pg_catalog.max(up.lvl), 0) into v_above from up;
    with recursive d(id, lvl) as (
      select v_lf.id, 1
      union all
      select f.id, d.lvl + 1 from public.app_library_folders f join d on f.parent_id = d.id
       where f.deleted_root_id = v_lf.id and d.lvl < 101
    )
    select pg_catalog.max(d.lvl) into v_height from d;
    if v_above + v_height > 100 then
      raise exception using errcode = '23514', message = 'LIB_FOLDER_DEPTH: folders are limited to 100 levels';
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

-- 3) 폴더 지우기(휴지통): 아래 폴더를 함께 숨기는 한도 10단 → 101단. 나머지는 20261025180000 원문 그대로.
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
  -- 같은 작업공간의 폴더 옮기기(순환·100단 검사)와 한 번에 하나씩.
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
         where c.id <> all (t.path) and pg_catalog.array_length(t.path, 1) < 101
       )
       select tree.id from tree
     );
  return null;
end
$$;
revoke all on function private.app_trash_library_folder_before_delete() from public, anon, authenticated, service_role;

-- 사후 확인: 함수 3개가 100단 모양, 모양(invoker/definer·search_path)·실행권 그대로. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_tree_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%project_id%'
         and prosrc like '%if v_above >= 100 then%' and prosrc like '%d.lvl < 101%' and prosrc like '%if v_above + v_height > 100 then%'
         and prosrc like '%LIB_FOLDER_CYCLE%' and prosrc like '%LIB_FOLDER_SCOPE%'
         and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_trash_restore(text,uuid)')
         and prosecdef and proconfig = array['search_path=""'] and prosrc like '%app_share_pages%'
         and prosrc like '%up.lvl < 101%' and prosrc like '%d.lvl < 101%' and prosrc like '%if v_above + v_height > 100 then%'
         and proacl::text ~ '(^|[{,])authenticated=X/' and proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_trash_library_folder_before_delete()')
         and prosecdef and proconfig = array['search_path=""'] and prosrc like '%array_length(t.path, 1) < 101%'
         and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 1
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_library_folders') and not tgisinternal
         and tgname in ('app_library_folders_tree_guard', 'app_library_folders_lift_on_delete', 'app_library_folders_a_trash_before_delete')) <> 3 then
    raise exception 'LIBRARY_FOLDER_DEPTH_100_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028113000', 'library_folder_depth_100', array['LIB-폴더100단: library folder depth limit 3 -> 100 (tree guard, trash restore depth check, trash before-delete subtree limit); cycle guard, owner-only access and grants unchanged']);
commit;
