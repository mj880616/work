begin;
-- TRASH-다른삭제 3단계(DB): 자료실 폴더(app_library_folders)의 [폴더 지우기]를 휴지통으로 보낸다. 앞 단계(20261025100000_trash_org_report_db)와 같은 방식이다.
-- 명진 결정 2026-10-25: 자료실 폴더도 [삭제] = 휴지통, [되돌리기] 있음, 영구 삭제는 직접만, 자동 비우기 없음, 연결 유지.
-- 설계 결정(폴더는 트리라서 프로젝트 휴지통처럼 묶음 칸이 필요하다):
--  1) 칸 2개: deleted_at(휴지통에 넣은 시각), deleted_root_id(같이 들어간 묶음의 맨 위 폴더). 둘은 함께 비거나 함께 찬다(짝 검사).
--  2) 삭제 가로채기 트리거 `app_library_folders_a_trash_before_delete`: 화면·서버가 폴더를 DELETE하면 그 폴더와 아래 폴더 전부에 표시만 하고 실제 삭제는 하지 않는다.
--     * 하위 폴더는 같은 묶음으로 함께 숨긴다. 이유: 지금의 [폴더 지우기]는 안의 것을 위로 올리지만, 휴지통에 넣는 동안은 아무것도 옮기지 않는 편이
--       "되돌리면 원래 구조 그대로"를 가장 단순하고 안전하게 지킨다(올려 두면 되돌릴 때 어느 것이 원래 안에 있었는지 따로 기억해야 한다).
--     * 자료는 폴더 안에 그대로 둔다(app_library_folder_items 행을 건드리지 않는다). 자료가 속한 폴더가 숨겨지면 화면은 그 자료를 '폴더 없음' 자리에
--       보이지 않고 자료실 목록에서 함께 숨긴다(화면 PR). 자료 원본(app_documents)·Drive 파일은 바뀌지 않고 프로젝트 상세·검색 등 다른 화면에는 그대로 보인다.
--     * 이 트리거는 기존 lift 트리거(`app_library_folders_lift_on_delete`, 안의 것을 한 단 위로)보다 먼저 돈다(이름 a < l). 표시만 하고 null을 돌려주므로 lift는 돌지 않는다.
--     * 이미 휴지통에 있는 폴더의 DELETE(영구 삭제)와 다른 삭제에 딸려 지워지는 행(작업공간 삭제 cascade, 트리거 깊이 2 이상)은 지금처럼 지운다.
--  3) 숨김 정책(restrictive, authenticated): 휴지통 폴더는 화면의 모든 조회·수정·삭제에서 빠지고, 화면이 표시 칸을 직접 채울 수 없다. 기존 정책은 그대로(교체·삭제 없음).
--     휴지통 폴더는 보이지 않으므로 자료를 그 폴더로 옮기거나 그 아래에 폴더를 만들 수도 없다(기존 정책의 폴더 확인이 그대로 막는다).
--  4) 휴지통 RPC 3개(app_trash_list/restore/purge)를 같은 서명으로 교체해 종류 'library_folder'를 더한다. 'project'·'organization'·'report' 동작은 그대로다.
--     * 되돌리기: 같은 묶음 전체를 한 번에. 위 폴더가 아직 휴지통이면 거절(TRASH_PARENT_IN_TRASH), 휴지통에 있는 동안 위 폴더가 깊은 곳으로 옮겨져 3단을 넘으면 거절(LIB_FOLDER_DEPTH).
--     * 영구 삭제: 지금의 폴더 지우기와 같다. 그 폴더만 지우고 안의 폴더·자료는 기존 lift 트리거가 한 단 위로 올린다. 함께 숨겨져 있던 하위 폴더는 올라간 자리를 따라 다시 보인다.
--     소유자(private.app_is_workspace_owner)만. 영구 삭제는 명진이 휴지통에서 직접 누를 때만 일어난다. 자동 비우기는 없다.
-- 트리거 함수는 DEFINER이고 본문에서 public 표만 직접 부른다(private 함수 호출 없음). service_role 경로의 `42501 permission denied for schema private`
-- (20261024210000_feed_item_guard_public 참고)를 만들지 않으며, service_role에 schema private 권한을 주지 않는다.
-- anon·PUBLIC 권한 없음. 이 표를 service_role로 읽는 Edge Function은 없다(조사: supabase/functions에 app_library_folders 사용처 없음).
-- 짝 파일: docs/20261025180000_trash_library_folder_db.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_library_folders in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025180000')
     -- 앞 단계(담당조직·사업 보고 휴지통)가 적용돼 있고 RPC 3개가 그 모양이어야 한다.
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025100000' and name = 'trash_org_report_db') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'), to_regprocedure('public.app_trash_restore(text,uuid)'),
         to_regprocedure('public.app_trash_purge(text,uuid)')) and prosecdef and proconfig = array['search_path=""']
         and prosrc like '%public.app_spaces%' and prosrc like '%app_suborganizations%' and prosrc like '%app_meetings%'
         and prosrc not like '%app_library_folders%') <> 3
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_trash_library_folder_before_delete()') is not null
     or to_regclass('public.app_library_folders') is null or to_regclass('public.app_library_folder_items') is null
     or to_regclass('public.app_library_folders_trash_idx') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders')
         and attname in ('deleted_at', 'deleted_root_id') and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_library_folders') and conname = 'app_library_folders_trash_pair_check')
     or exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_library_folders') and tgname = 'app_library_folders_a_trash_before_delete')
     or exists (select 1 from pg_policy where polrelid = to_regclass('public.app_library_folders') and polname = 'app_library_folders_trash_hidden')
     -- 쓰는 칸이 있고 모양이 맞아야 한다.
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_library_folders') and not attisdropped
         and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname in ('project_id', 'parent_id') and atttypid = 'uuid'::regtype)
              or (attname = 'name' and atttypid = 'text'::regtype))) <> 5
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_library_folder_items') and not attisdropped
         and attname in ('document_id', 'folder_id', 'workspace_id') and atttypid = 'uuid'::regtype) <> 3
     -- 기존 폴더 트리거(검사·한 단 위로)가 그대로 있어야 한다.
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_library_folders') and not tgisinternal
         and tgname in ('app_library_folders_tree_guard', 'app_library_folders_lift_on_delete')) <> 2
     -- RLS 켜짐·force 꺼짐(트리거·RPC가 소유자 권한으로 표시 칸을 쓴다).
     or (select count(*) from pg_class where oid = to_regclass('public.app_library_folders') and relrowsecurity and not relforcerowsecurity) <> 1
     -- 적용하는 역할이 표의 소유자이거나 RLS를 건너뛴다(트리거·RPC의 소유자가 된다).
     or (select count(*) from pg_class c join pg_roles r on r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner)
         where c.oid = to_regclass('public.app_library_folders')) <> 1
     -- 새 삭제 트리거가 같은 표의 다른 삭제 전 행 트리거보다 먼저 돌아야 한다(이름 순서).
     or exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.app_library_folders') and not t.tgisinternal
         and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8
         and convert_to(t.tgname::text, 'UTF8') < convert_to('app_library_folders_a_trash_before_delete', 'UTF8')) then
    raise exception 'TRASH_LIBRARY_FOLDER_PREREQUISITE_CHANGED: schema differs; stop';
  end if;
end
$$;

alter table public.app_library_folders
  add column deleted_at timestamptz,
  add column deleted_root_id uuid;
alter table public.app_library_folders
  add constraint app_library_folders_trash_pair_check check ((deleted_at is null) = (deleted_root_id is null));
create index app_library_folders_trash_idx on public.app_library_folders (workspace_id, deleted_root_id) where deleted_at is not null;

-- 화면(authenticated)에서 휴지통 폴더를 숨기고, 표시 칸을 직접 채우지 못하게 한다. 좁히기만 하는 restrictive 정책이다.
create policy app_library_folders_trash_hidden on public.app_library_folders as restrictive for all to authenticated
  using (deleted_at is null) with check (deleted_at is null and deleted_root_id is null);

-- 삭제 가로채기: 그 폴더와 아래 폴더 전부에 표시만 하고 실제 삭제를 건너뛴다. 자료 연결 행은 건드리지 않는다.
-- 영구 삭제(이미 휴지통 폴더)와 다른 삭제에 딸린 cascade 삭제는 지금처럼 지운다(그때 기존 lift 트리거가 돈다).
create function private.app_trash_library_folder_before_delete()
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

create trigger app_library_folders_a_trash_before_delete
before delete on public.app_library_folders
for each row execute function private.app_trash_library_folder_before_delete();

-- 휴지통 목록: 종류별로 소유한 작업공간만. 'project'·'library_folder'는 묶음의 맨 위 행만, 나머지는 휴지통 행 전부(이름·넣은 시각).
create or replace function public.app_trash_list(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'project' then
    return coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', 'project',
               'id', s.id,
               'workspace_id', s.workspace_id,
               'name', s.name,
               'parent_id', s.parent_id,
               'deleted_at', s.deleted_at,
               'child_count', (select pg_catalog.count(*) from public.app_spaces c
                                where c.deleted_root_id = s.id and c.id <> s.id),
               'parent_in_trash', coalesce((select p.deleted_at is not null from public.app_spaces p where p.id = s.parent_id), false))
             order by s.deleted_at desc, s.id)
      from public.app_spaces s
      where s.deleted_at is not null
        and s.deleted_root_id = s.id
        and private.app_is_workspace_owner(s.workspace_id)
    ), '[]'::jsonb);
  elsif p_kind = 'organization' then
    return coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', 'organization',
               'id', o.id,
               'workspace_id', o.workspace_id,
               'name', o.name,
               'deleted_at', o.deleted_at)
             order by o.deleted_at desc, o.id)
      from public.app_suborganizations o
      where o.deleted_at is not null
        and private.app_is_workspace_owner(o.workspace_id)
    ), '[]'::jsonb);
  elsif p_kind = 'report' then
    return coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', 'report',
               'id', m.id,
               'workspace_id', m.workspace_id,
               'title', m.title,
               'series_name', m.series_name,
               'round_no', m.round_no,
               'meeting_at', m.meeting_at,
               'activity_kind', m.activity_kind,
               'deleted_at', m.deleted_at)
             order by m.deleted_at desc, m.id)
      from public.app_meetings m
      where m.deleted_at is not null
        and private.app_is_workspace_owner(m.workspace_id)
    ), '[]'::jsonb);
  elsif p_kind = 'library_folder' then
    return coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', 'library_folder',
               'id', f.id,
               'workspace_id', f.workspace_id,
               'name', f.name,
               'project_id', f.project_id,
               'project_name', (select sp.name from public.app_spaces sp where sp.id = f.project_id),
               'parent_id', f.parent_id,
               'deleted_at', f.deleted_at,
               'child_count', (select pg_catalog.count(*) from public.app_library_folders c
                                where c.deleted_root_id = f.id and c.id <> f.id),
               'file_count', (select pg_catalog.count(*) from public.app_library_folder_items i
                               join public.app_library_folders c on c.id = i.folder_id
                              where c.deleted_root_id = f.id),
               'parent_in_trash', coalesce((select p.deleted_at is not null from public.app_library_folders p where p.id = f.parent_id), false))
             order by f.deleted_at desc, f.id)
      from public.app_library_folders f
      where f.deleted_at is not null
        and f.deleted_root_id = f.id
        and private.app_is_workspace_owner(f.workspace_id)
    ), '[]'::jsonb);
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_list(text) from public, anon, service_role;
grant execute on function public.app_trash_list(text) to authenticated;

-- 되돌리기: 표시만 비운다. 'project'·'library_folder'는 같은 묶음 전체(상위가 아직 휴지통이면 거절), 나머지는 그 한 행.
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
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_restore(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_restore(text, uuid) to authenticated;

-- 영구 삭제: 휴지통 행만 지운다. 기존 연결 해제 트리거(프로젝트)와 cascade·set null이 지금의 삭제와 똑같이 돈다.
create or replace function public.app_trash_purge(p_kind text, p_id uuid)
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
    delete from public.app_spaces s
     where s.id = v_root.id and s.deleted_at is not null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'project', 'id', v_root.id);
  elsif p_kind = 'organization' then
    select o.workspace_id into v_ws from public.app_suborganizations o
     where o.id = p_id and o.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    delete from public.app_suborganizations o where o.id = p_id and o.deleted_at is not null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'organization', 'id', p_id);
  elsif p_kind = 'report' then
    select m.workspace_id into v_ws from public.app_meetings m
     where m.id = p_id and m.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    delete from public.app_meetings m where m.id = p_id and m.deleted_at is not null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'report', 'id', p_id);
  elsif p_kind = 'library_folder' then
    -- 영구 삭제는 지금의 폴더 지우기와 같다: 이 폴더만 지우고 안의 폴더·자료는 한 단 위로 올린다(기존 lift 트리거).
    -- 함께 숨겨져 있던 하위 폴더는 올라가는 자리의 상태를 따른다(그 자리가 보이면 다시 보이고, 그 자리도 휴지통이면 그 묶음에 들어간다).
    select * into v_lf from public.app_library_folders f
     where f.id = p_id and f.deleted_at is not null and f.deleted_root_id = f.id
     for update;
    if not found or not private.app_is_workspace_owner(v_lf.workspace_id) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_library_folders_tree:' || v_lf.workspace_id::text, 0));
    select p.deleted_at, p.deleted_root_id into v_pdel, v_proot from public.app_library_folders p
     where p.id = v_lf.parent_id and p.deleted_at is not null;
    update public.app_library_folders f
       set deleted_at = v_pdel, deleted_root_id = v_proot
     where f.deleted_root_id = v_lf.id and f.id <> v_lf.id
       and f.workspace_id = v_lf.workspace_id;
    delete from public.app_library_folders f
     where f.id = v_lf.id and f.deleted_at is not null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'library_folder', 'id', v_lf.id);
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_purge(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_purge(text, uuid) to authenticated;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025180000', 'trash_library_folder_db', array['TRASH-다른삭제 3단계: app_library_folders deleted_at/deleted_root_id, delete-to-trash trigger, restrictive hide policy, app_trash_list/restore/purge kind library_folder']);
commit;
