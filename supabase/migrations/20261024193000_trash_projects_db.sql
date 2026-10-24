begin;
-- TRASH-삭제휴지통 1단계(DB). 명진 결정 2026-10-24: "앞으론 삭제 시 휴지통으로".
-- 프로젝트(app_spaces) [삭제]를 바로 지우지 않고 휴지통 표시(deleted_at)로 바꾼다. 되돌리기는 표시를 비우는 것뿐이다.
--  1) 칸 2개: deleted_at(휴지통에 넣은 시각), deleted_root_id(같이 휴지통에 들어간 묶음의 맨 위 프로젝트). 둘은 함께 비거나 함께 찬다.
--  2) 삭제 가로채기 트리거: 사용자가 프로젝트를 DELETE하면 그 프로젝트와 아래 프로젝트 전부에 표시만 하고 실제 삭제는 하지 않는다.
--     그래서 기존 연결 해제 트리거(app_spaces_unlink_retained_records_before_delete)와 cascade(진행기록·주요 일정·의견 등)가
--     돌지 않는다. 이름이 그 트리거보다 앞서서(a < u) 먼저 돈다. 이미 휴지통에 있는 행의 DELETE(영구 삭제)와
--     다른 삭제에 딸려 지워지는 행(상위의 영구 삭제·작업공간 삭제의 cascade, 트리거 깊이 2 이상)은 지금처럼 지운다.
--  3) 숨김 정책(restrictive, authenticated): 휴지통 행은 화면의 모든 조회·수정·삭제에서 빠지고, 화면이 직접 표시 칸을 채울 수 없다.
--     기존 정책은 그대로 두고 좁히기만 한다(교체·삭제 없음). 그래서 화면 코드를 고치기 전에도 지운 프로젝트가 다시 보이지 않는다.
--  4) 휴지통 RPC 3개(종류 p_kind로 나눔, 지금은 'project'만): 목록·되돌리기·영구 삭제. 소유자(private.app_is_workspace_owner)만.
--     영구 삭제는 명진이 휴지통에서 직접 누를 때만 일어난다. 자동 비우기는 없다.
-- anon·PUBLIC 권한 없음. service_role은 원래 RLS를 건너뛰므로 Edge Function 조회는 별도 PR에서 deleted_at을 거른다(PR 본문).
-- 짝 파일: docs/20261024193000_trash_projects_db.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_spaces in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024193000')
     or to_regclass('public.app_spaces') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_spaces')
         and attname in ('deleted_at', 'deleted_root_id') and not attisdropped)
     or to_regprocedure('private.app_trash_space_before_delete()') is not null
     or to_regprocedure('public.app_trash_list(text)') is not null
     or to_regprocedure('public.app_trash_restore(text,uuid)') is not null
     or to_regprocedure('public.app_trash_purge(text,uuid)') is not null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_spaces') and tgname = 'app_spaces_a_trash_before_delete')
     or exists (select 1 from pg_policy where polrelid = to_regclass('public.app_spaces') and polname = 'app_spaces_trash_hidden')
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_spaces') and conname = 'app_spaces_trash_pair_check')
     or to_regclass('public.app_spaces_trash_root_idx') is not null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_spaces') and not attisdropped
         and atttypid = 'uuid'::regtype and attname in ('id', 'workspace_id', 'parent_id')) <> 3
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_spaces') and attname = 'name' and not attisdropped)
     -- RLS 켜짐·force 꺼짐(트리거·RPC가 소유자 권한으로 표시 칸을 쓴다).
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_spaces') and relrowsecurity and not relforcerowsecurity)
     -- 적용하는 역할이 표 소유자이거나 RLS를 건너뛴다(트리거·RPC의 소유자가 된다).
     or not exists (select 1 from pg_roles r join pg_class c on c.oid = to_regclass('public.app_spaces')
         where r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner))
     -- parent_id는 자기 참조 외래키이고 상위 삭제 때 하위도 지워진다(on delete cascade). 영구 삭제가 이 동작에 기댄다.
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_spaces') and contype = 'f'
         and confrelid = to_regclass('public.app_spaces') and confdeltype = 'c'
         and conkey = array[(select attnum from pg_attribute where attrelid = to_regclass('public.app_spaces') and attname = 'parent_id')]) <> 1
     -- 행 단위 BEFORE DELETE 트리거는 기존 연결 해제 트리거 하나뿐이어야 한다(새 트리거가 그보다 먼저 돌아야 한다).
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_spaces') and not tgisinternal
         and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 8) = 8) <> 1
     or not exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_spaces') and not tgisinternal
         and tgname = 'app_spaces_unlink_retained_records_before_delete' and tgenabled = 'O'
         and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 8) = 8) then
    raise exception 'TRASH_PROJECTS_PREREQUISITE_CHANGED: schema differs; stop';
  end if;
end
$$;

alter table public.app_spaces
  add column deleted_at timestamptz,
  add column deleted_root_id uuid;
alter table public.app_spaces
  add constraint app_spaces_trash_pair_check check ((deleted_at is null) = (deleted_root_id is null));
create index app_spaces_trash_root_idx on public.app_spaces (workspace_id, deleted_root_id) where deleted_at is not null;

-- 화면(authenticated)에서 휴지통 행을 숨기고, 표시 칸을 직접 채우지 못하게 한다. 좁히기만 하는 restrictive 정책이다.
create policy app_spaces_trash_hidden on public.app_spaces as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null and deleted_root_id is null);

-- 삭제 가로채기: 맨 위 프로젝트와 아래 프로젝트(아직 휴지통에 없는 것만)에 같은 묶음 표시를 하고 실제 삭제를 건너뛴다.
create function private.app_trash_space_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 영구 삭제(이미 휴지통 행)와 다른 삭제에 딸린 cascade 삭제는 지금처럼 지운다.
  if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_spaces s
     set deleted_at = pg_catalog.now(), deleted_root_id = old.id
   where s.deleted_at is null
     and s.workspace_id = old.workspace_id
     and s.id in (
       with recursive tree(id, path) as (
         select old.id, array[old.id]
         union all
         select c.id, t.path || c.id
         from public.app_spaces c join tree t on c.parent_id = t.id
         where c.id <> all (t.path) and pg_catalog.array_length(t.path, 1) < 10
       )
       select tree.id from tree
     );
  return null;
end
$$;
revoke all on function private.app_trash_space_before_delete() from public, anon, authenticated, service_role;

create trigger app_spaces_a_trash_before_delete
before delete on public.app_spaces
for each row execute function private.app_trash_space_before_delete();

-- 휴지통 목록: 묶음의 맨 위 행만, 소유한 작업공간만. 이름·상위·넣은 시각·같이 들어간 하위 수·상위도 휴지통인지.
create function public.app_trash_list(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind is distinct from 'project' then
    raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
  end if;
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
end
$$;
revoke all on function public.app_trash_list(text) from public, anon, service_role;
grant execute on function public.app_trash_list(text) to authenticated;

-- 되돌리기: 같은 묶음의 표시만 비운다. 상위 프로젝트가 아직 휴지통이면 거절한다(상위부터 되돌린다).
create function public.app_trash_restore(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.app_spaces%rowtype;
  v_count integer;
begin
  if p_kind is distinct from 'project' then
    raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
  end if;
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
end
$$;
revoke all on function public.app_trash_restore(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_restore(text, uuid) to authenticated;

-- 영구 삭제: 휴지통 묶음의 맨 위 행만 지운다. 기존 연결 해제 트리거와 cascade가 지금의 삭제와 똑같이 돈다.
create function public.app_trash_purge(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.app_spaces%rowtype;
  v_count integer;
begin
  if p_kind is distinct from 'project' then
    raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
  end if;
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
end
$$;
revoke all on function public.app_trash_purge(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_purge(text, uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024193000', 'trash_projects_db', array['TRASH-삭제휴지통 1단계: app_spaces deleted_at/deleted_root_id, delete-to-trash trigger, restrictive hide policy, app_trash_list/restore/purge']);
commit;
