begin;
-- TRASH-다른삭제 2단계(DB): 프로젝트 휴지통(20261024193000)과 같은 방식을 담당조직(app_suborganizations)과 사업 보고(app_meetings)에 넓힌다.
-- 명진 결정 2026-10-25: 담당조직·사업 보고·자료·노트·공유 페이지·자료실 폴더도 [삭제] = 휴지통, [되돌리기] 있음, 영구 삭제는 직접만, 자동 비우기 없음, 연결 유지.
-- 이 파일은 위험이 낮고 모양이 같은 두 표만 한다(나머지 네 가지는 PR 본문의 다음 순서). 프로젝트 휴지통 동작은 그대로다.
--  1) 칸 1개: deleted_at(휴지통에 넣은 시각). 두 표는 평평한 목록이라 프로젝트의 묶음 칸(deleted_root_id)은 필요 없다.
--  2) 삭제 가로채기 트리거: 화면·서버가 DELETE하면 그 행에 표시만 하고 실제 삭제는 하지 않는다. 그래서 연결 표의 cascade·set null이 돌지 않는다
--     (조직: 기록·담당자·타임라인·쟁의단계·메모 연결·원장 연결 등, 사업 보고: 메모 연결·원장 연결 등 — 전부 그대로 남는다).
--     이미 휴지통에 있는 행의 DELETE(영구 삭제)와 다른 삭제에 딸려 지워지는 행(작업공간 삭제의 cascade, 트리거 깊이 2 이상)은 지금처럼 지운다.
--     트리거 이름은 `<표>_a_trash_before_delete`라서 같은 표의 다른 삭제 트리거보다 먼저 돈다(적용 전 확인에서 그렇지 않으면 멈춘다).
--  3) 숨김 정책(restrictive, authenticated): 휴지통 행은 화면의 모든 조회·수정·삭제에서 빠지고, 화면이 직접 표시 칸을 채울 수 없다.
--     기존 정책은 그대로 두고 좁히기만 한다(교체·삭제 없음).
--  4) 휴지통 RPC 3개(app_trash_list/restore/purge)를 같은 서명으로 교체해 종류 'organization'·'report'를 더한다. 'project' 동작은 그대로다.
--     소유자(private.app_is_workspace_owner)만. 영구 삭제는 명진이 휴지통에서 직접 누를 때만 일어난다. 자동 비우기는 없다.
-- 트리거 함수는 DEFINER이고 본문에서 public 표만 직접 부른다(private 함수 호출 없음). service_role 경로의 `42501 permission denied for schema private`
-- (20261024210000_feed_item_guard_public 참고)를 만들지 않으며, service_role에 schema private 권한을 주지 않는다.
-- anon·PUBLIC 권한 없음. service_role은 원래 RLS를 건너뛰므로 Edge Function 조회는 별도 PR에서 deleted_at을 거른다(PR 본문).
-- 짝 파일: docs/20261025100000_trash_org_report_db.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_suborganizations, public.app_meetings in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
declare
  v_t text;
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025100000')
     -- 앞 단계(프로젝트 휴지통)가 적용돼 있고 RPC 3개가 프로젝트 전용 모양이어야 한다.
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024193000' and name = 'trash_projects_db') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'), to_regprocedure('public.app_trash_restore(text,uuid)'),
         to_regprocedure('public.app_trash_purge(text,uuid)')) and prosecdef and proconfig = array['search_path=""']
         and prosrc like '%public.app_spaces%' and prosrc not like '%app_suborganizations%' and prosrc not like '%app_meetings%') <> 3
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_trash_org_before_delete()') is not null
     or to_regprocedure('private.app_trash_report_before_delete()') is not null
     or to_regclass('public.app_suborganizations') is null or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_suborganizations_trash_idx') is not null or to_regclass('public.app_meetings_trash_idx') is not null
     or exists (select 1 from pg_attribute where attrelid in (to_regclass('public.app_suborganizations'), to_regclass('public.app_meetings'))
         and attname = 'deleted_at' and not attisdropped)
     or exists (select 1 from pg_trigger where tgrelid in (to_regclass('public.app_suborganizations'), to_regclass('public.app_meetings'))
         and tgname in ('app_suborganizations_a_trash_before_delete', 'app_meetings_a_trash_before_delete'))
     or exists (select 1 from pg_policy where polrelid in (to_regclass('public.app_suborganizations'), to_regclass('public.app_meetings'))
         and polname in ('app_suborganizations_trash_hidden', 'app_meetings_trash_hidden'))
     -- 쓰는 칸이 있고 모양이 맞아야 한다.
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and not attisdropped
         and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname = 'name' and atttypid = 'text'::regtype))) <> 3
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_meetings') and not attisdropped
         and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname = 'title' and atttypid = 'text'::regtype)
              or (attname in ('series_name', 'activity_kind') and atttypid = 'text'::regtype)
              or (attname = 'round_no') or (attname = 'meeting_at'))) <> 7
     -- RLS 켜짐·force 꺼짐(트리거·RPC가 소유자 권한으로 표시 칸을 쓴다).
     or (select count(*) from pg_class where oid in (to_regclass('public.app_suborganizations'), to_regclass('public.app_meetings'))
         and relrowsecurity and not relforcerowsecurity) <> 2
     -- 적용하는 역할이 두 표의 소유자이거나 RLS를 건너뛴다(트리거·RPC의 소유자가 된다).
     or (select count(*) from pg_class c join pg_roles r on r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner)
         where c.oid in (to_regclass('public.app_suborganizations'), to_regclass('public.app_meetings'))) <> 2
     -- 새 삭제 트리거가 같은 표의 다른 삭제 전 행 트리거보다 먼저 돌아야 한다(이름 순서).
     or exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.app_suborganizations') and not t.tgisinternal
         and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and t.tgname collate "C" < 'app_suborganizations_a_trash_before_delete')
     or exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.app_meetings') and not t.tgisinternal
         and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and t.tgname collate "C" < 'app_meetings_a_trash_before_delete') then
    raise exception 'TRASH_ORG_REPORT_PREREQUISITE_CHANGED: schema differs; stop';
  end if;
end
$$;

alter table public.app_suborganizations add column deleted_at timestamptz;
alter table public.app_meetings add column deleted_at timestamptz;
create index app_suborganizations_trash_idx on public.app_suborganizations (workspace_id, deleted_at) where deleted_at is not null;
create index app_meetings_trash_idx on public.app_meetings (workspace_id, deleted_at) where deleted_at is not null;

-- 화면(authenticated)에서 휴지통 행을 숨기고, 표시 칸을 직접 채우지 못하게 한다. 좁히기만 하는 restrictive 정책이다.
create policy app_suborganizations_trash_hidden on public.app_suborganizations as restrictive for all to authenticated
  using (deleted_at is null) with check (deleted_at is null);
create policy app_meetings_trash_hidden on public.app_meetings as restrictive for all to authenticated
  using (deleted_at is null) with check (deleted_at is null);

-- 삭제 가로채기: 그 행에 표시만 하고 실제 삭제를 건너뛴다. 영구 삭제(이미 휴지통 행)와 다른 삭제에 딸린 cascade 삭제는 지금처럼 지운다.
create function private.app_trash_org_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_suborganizations set deleted_at = pg_catalog.now() where id = old.id and deleted_at is null;
  return null;
end
$$;
revoke all on function private.app_trash_org_before_delete() from public, anon, authenticated, service_role;

create function private.app_trash_report_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null or pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_meetings set deleted_at = pg_catalog.now() where id = old.id and deleted_at is null;
  return null;
end
$$;
revoke all on function private.app_trash_report_before_delete() from public, anon, authenticated, service_role;

create trigger app_suborganizations_a_trash_before_delete
before delete on public.app_suborganizations
for each row execute function private.app_trash_org_before_delete();
create trigger app_meetings_a_trash_before_delete
before delete on public.app_meetings
for each row execute function private.app_trash_report_before_delete();

-- 휴지통 목록: 종류별로 소유한 작업공간만. 'project'는 묶음의 맨 위 행만(그대로), 나머지는 휴지통 행 전부(이름·넣은 시각).
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
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_list(text) from public, anon, service_role;
grant execute on function public.app_trash_list(text) to authenticated;

-- 되돌리기: 표시만 비운다. 'project'는 같은 묶음 전체(상위가 아직 휴지통이면 거절), 나머지는 그 한 행.
create or replace function public.app_trash_restore(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.app_spaces%rowtype;
  v_ws uuid;
  v_count integer;
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
  v_ws uuid;
  v_count integer;
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
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_purge(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_purge(text, uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025100000', 'trash_org_report_db', array['TRASH-다른삭제 2단계: app_suborganizations/app_meetings deleted_at, delete-to-trash triggers, restrictive hide policies, app_trash_list/restore/purge kinds organization and report']);
commit;
