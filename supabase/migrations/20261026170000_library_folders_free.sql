begin;
-- LIB-폴더탐색기 DB(명진 결정 2026-10-26 '가'): 자료실 폴더를 프로젝트와 상관없이 자유롭게 쓴다.
-- 지금은 폴더 안 폴더, 자료를 폴더에 넣기가 모두 "같은 프로젝트 틀"이어야 한다(트리거 1개 + 자료 연결 정책 1개). 이 틀 제한만 푼다.
-- 바꾸는 것 3가지(표·칸·권한은 그대로, 새 표·새 칸 없음):
--  1) private.app_library_folder_tree_guard(): 상위 폴더가 같은 작업공간이면 프로젝트가 달라도 허용. 순환 금지·3단 제한·작업공간 잠금은 그대로.
--  2) private.app_library_folder_lift(): 폴더를 지울 때(영구 삭제) 안의 폴더·자료를 상위로 올린다. 프로젝트가 다른 자료도 올린다(틀이 사라졌으므로).
--     맨 위 폴더였으면 자료 연결만 지운다(자료는 폴더 밖). 자료·Drive 파일은 지우지 않는다.
--  3) 정책 library_folder_items_owner_all: 넣기·옮기기 검사에서 "자료의 project_id = 폴더의 project_id" 조건만 뺀다.
--     소유자 확인(private.app_is_workspace_owner)과 "폴더·자료가 같은 작업공간" 확인은 그대로다. 같은 이름·같은 대상 역할(authenticated만)로 교체한다.
-- 자료의 프로젝트(app_documents.project_id)는 어느 경우에도 바뀌지 않는다. 폴더 옮기기·자료 넣기는 프로젝트 연결을 건드리지 않는다.
-- 권한 확대 없음: 읽고 쓸 수 있는 사람은 소유자 한 사람 그대로, anon·PUBLIC·service_role 권한 없음, 열 권한(project_id·workspace_id 고칠 수 없음)도 그대로.
-- 이미 만든 폴더·연결은 한 줄도 바꾸지 않는다.
-- 정책 교체(drop policy + create policy)는 같은 이름·같은 표·authenticated만·항상 참 조건 없음이라 승인형 DB workflow 확장 규칙(정책 교체)이 받는다. 운영 정의와 비교해 넓어지면 workflow가 멈춘다.
-- SQL Editor 새 쿼리 창(폰 경로 C)으로도 적용할 수 있다.
-- 짝: docs/20261026170000_library_folders_free.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folders, public.app_library_folder_items in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026170000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261022120000' and name = 'library_folders') <> 1
     or to_regclass('public.app_library_folders') is null
     or to_regclass('public.app_library_folder_items') is null
     or to_regclass('public.app_documents') is null
     -- 지금 함수·정책이 첫 모양(같은 프로젝트 틀 검사)이어야 한다.
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_tree_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%f.project_id is not distinct from new.project_id%') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_lift()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%d.project_id is not distinct from old.project_id%') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_library_folder_items') and polname = 'library_folder_items_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*'
         and pg_get_expr(polwithcheck, polrelid) like '%d.project_id IS DISTINCT FROM f.project_id%') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_library_folder_items')) <> 1
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_library_folders') and not tgisinternal
         and tgname in ('app_library_folders_tree_guard', 'app_library_folders_lift_on_delete')) <> 2
     or (select count(*) from pg_class where oid in (to_regclass('public.app_library_folders'), to_regclass('public.app_library_folder_items'))
         and relrowsecurity and not relforcerowsecurity) <> 2
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null then
    raise exception 'LIBRARY_FOLDERS_FREE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 상위 폴더 검사: 같은 작업공간이면 프로젝트가 달라도 된다. 순환·3단·잠금은 그대로.
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
-- 함수 실행권은 새 함수와 같은 기준으로 PUBLIC·anon에서 다시 회수한다(이미 없으면 변화 없음, 권한 확대 아님).
revoke all on function private.app_library_folder_tree_guard() from public, anon;

-- 2) 폴더를 지우면 안의 폴더·자료는 한 단 위로. 맨 위 폴더였으면 자료 연결만 지운다. 프로젝트가 다른 자료도 올린다.
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
  if old.parent_id is null then
    delete from public.app_library_folder_items where folder_id = old.id;
  else
    update public.app_library_folder_items set folder_id = old.parent_id
      where folder_id = old.id;
  end if;
  return old;
end
$lift$;
revoke all on function private.app_library_folder_lift() from public, anon;

-- 3) 자료 연결 정책 교체: 같은 이름·같은 대상(authenticated). "같은 프로젝트" 조건만 뺀다.
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
        and d.workspace_id = app_library_folder_items.workspace_id));

-- 사후 확인: 정책 1개(authenticated만, 프로젝트 조건 없음, 소유자·작업공간 조건 있음), 함수 모양, 권한 그대로. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_policy where polrelid = 'public.app_library_folder_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_folder_items'::regclass and polname = 'library_folder_items_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*'
         and pg_get_expr(polqual, polrelid) like '%app_is_workspace_owner(workspace_id)%'
         and pg_get_expr(polwithcheck, polrelid) like '%app_is_workspace_owner(workspace_id)%'
         and pg_get_expr(polwithcheck, polrelid) like '%d.workspace_id = app_library_folder_items.workspace_id%'
         and pg_get_expr(polwithcheck, polrelid) not like '%project_id%') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_library_folder_tree_guard()'), to_regprocedure('private.app_library_folder_lift()'))
         and not prosecdef and proconfig = array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 2
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_tree_guard()') and prosrc not like '%project_id%') <> 1
     or exists (select 1 from pg_class where oid in ('public.app_library_folders'::regclass, 'public.app_library_folder_items'::regclass)
             and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or has_column_privilege('authenticated', 'public.app_library_folders', 'project_id', 'update')
     or has_column_privilege('authenticated', 'public.app_library_folder_items', 'document_id', 'update') then
    raise exception 'LIBRARY_FOLDERS_FREE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026170000', 'library_folders_free', array['LIB-폴더탐색기: library folders no longer limited to one project frame (tree guard, lift-on-delete, folder items policy without project match); owner-only RLS and grants unchanged']);
commit;
