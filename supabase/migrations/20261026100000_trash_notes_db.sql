begin;
-- TRASH-다른삭제 4단계(DB): 노트·업데이트(app_notes 종류 basket·note)의 [지우기]를 휴지통으로 보낸다. 앞 단계(20261025180000_trash_library_folder_db)와 같은 방식이다.
-- 명진 결정 2026-10-25: 노트도 [삭제] = 휴지통, [되돌리기] 있음, 영구 삭제는 직접만, 자동 비우기 없음, 연결 유지.
-- 설계 결정:
--  1) 칸 1개: deleted_at(휴지통에 넣은 시각). 노트는 평평한 목록이라 묶음 칸이 필요 없다(담당조직·사업 보고와 같은 모양).
--  2) 삭제 가로채기 트리거 `app_notes_a_trash_before_delete`: 종류가 basket·note인 행의 DELETE는 표시만 하고 실제 삭제는 하지 않는다.
--     그래서 연결 표(app_record_links.note_id)의 cascade가 돌지 않아 바구니 연결·원장 근거로 쓰인 연결 행이 그대로 남는다. 첨부 파일(Drive)도 건드리지 않는다.
--     * 종류가 work(업무일지 한 줄)·diary(일기)인 행은 이번 범위가 아니다: 하루 1행 고유 색인(app_notes_journal_day_unique)을 숨은 행이 계속 차지해
--       같은 날 다시 쓰지 못하는 문제가 있어 지금처럼 바로 지운다(트리거가 그대로 통과시킨다).
--     * 이미 휴지통에 있는 행의 DELETE(영구 삭제)와 다른 삭제에 딸려 지워지는 행(작업공간 삭제 cascade, 트리거 깊이 2 이상)은 지금처럼 지운다.
--     * updated_at(원본 버전)은 바꾸지 않는다. 표시와 되돌리기는 본문 버전을 건드리지 않는다.
--  3) 숨김 정책(restrictive, authenticated): 휴지통 노트는 화면의 모든 조회·수정·삭제에서 빠지고, 화면이 표시 칸을 직접 채울 수 없다. 기존 정책(notes_owner_all)은 그대로(교체·삭제 없음).
--     바구니 연결 함수·검색·AI 요약처럼 로그인 권한(INVOKER)으로 노트를 읽는 모든 경로는 이 정책으로 자동으로 휴지통 노트를 보지 못한다.
--     서버 키(service_role)로 읽는 Edge Function은 RLS를 건너뛰므로 별도 PR에서 거른다(PR 본문의 전수 목록).
--  4) 휴지통 RPC 3개(app_trash_list/restore/purge)를 같은 서명으로 교체해 종류 'note'를 더한다. 'project'·'organization'·'report'·'library_folder' 동작은 그대로다.
--     소유자(private.app_is_workspace_owner)만. 되돌리기는 표시만 비운다. 영구 삭제는 지금의 노트 지우기와 같다(연결은 cascade로 함께 지워지고 Drive 파일은 그대로).
--     영구 삭제는 명진이 휴지통에서 직접 누를 때만 일어난다. 자동 비우기는 없다.
-- 트리거 함수는 DEFINER이고 본문에서 public 표만 직접 부른다(private 함수 호출 없음). service_role 경로의 `42501 permission denied for schema private`
-- (20261024210000_feed_item_guard_public 참고)를 만들지 않으며, service_role에 schema private 권한을 주지 않는다.
-- anon·PUBLIC 권한 없음. 기존 Edge Function note-delete(basket-files)는 이 트리거 뒤에는 행을 지우지 못한다: 화면이 그 경로를 더 쓰지 않는다(화면 PR).
-- 짝 파일: docs/20261026100000_trash_notes_db.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_notes in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026100000')
     -- 앞 단계(자료실 폴더 휴지통)가 적용돼 있고 RPC 3개가 그 모양이어야 한다.
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025180000' and name = 'trash_library_folder_db') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'), to_regprocedure('public.app_trash_restore(text,uuid)'),
         to_regprocedure('public.app_trash_purge(text,uuid)')) and prosecdef and proconfig = array['search_path=""']
         and prosrc like '%public.app_spaces%' and prosrc like '%app_suborganizations%' and prosrc like '%app_meetings%'
         and prosrc like '%app_library_folders%' and prosrc not like '%app_notes%') <> 3
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_trash_note_before_delete()') is not null
     or to_regclass('public.app_notes') is null or to_regclass('public.app_record_links') is null
     or to_regclass('public.app_notes_trash_idx') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'deleted_at' and not attisdropped)
     or exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_notes') and tgname = 'app_notes_a_trash_before_delete')
     or exists (select 1 from pg_policy where polrelid = to_regclass('public.app_notes') and polname = 'app_notes_trash_hidden')
     -- 쓰는 칸이 있고 모양이 맞아야 한다.
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_notes') and not attisdropped
         and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname in ('kind', 'title', 'raw_text') and atttypid = 'text'::regtype)
              or (attname = 'attachments' and atttypid = 'jsonb'::regtype) or (attname = 'occurred_at' and atttypid = 'timestamptz'::regtype))) <> 8
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_record_links') and not attisdropped
         and attname = 'note_id' and atttypid = 'uuid'::regtype) <> 1
     -- 연결 표의 note_id는 노트가 지워질 때 함께 지워지는 외래키(cascade)여야 한다(영구 삭제의 동작).
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_record_links') and contype = 'f'
         and confrelid = to_regclass('public.app_notes') and confdeltype = 'c') <> 1
     -- 노트 표에 다른 사용자 트리거가 없어야 한다(순서·동작이 이 파일의 가정과 같다). 정책은 기존 소유자 정책 1개뿐이어야 한다.
     or exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_notes') and not tgisinternal)
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_notes')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_notes') and polname = 'notes_owner_all' and polpermissive) <> 1
     -- RLS 켜짐·force 꺼짐(트리거·RPC가 소유자 권한으로 표시 칸을 쓴다).
     or (select count(*) from pg_class where oid = to_regclass('public.app_notes') and relrowsecurity and not relforcerowsecurity) <> 1
     -- 적용하는 역할이 표의 소유자이거나 RLS를 건너뛴다(트리거·RPC의 소유자가 된다).
     or (select count(*) from pg_class c join pg_roles r on r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner)
         where c.oid = to_regclass('public.app_notes')) <> 1 then
    raise exception 'TRASH_NOTES_PREREQUISITE_CHANGED: schema differs; stop';
  end if;
end
$$;

alter table public.app_notes add column deleted_at timestamptz;
create index app_notes_trash_idx on public.app_notes (workspace_id, deleted_at) where deleted_at is not null;

-- 화면(authenticated)에서 휴지통 노트를 숨기고, 표시 칸을 직접 채우지 못하게 한다. 좁히기만 하는 restrictive 정책이다.
create policy app_notes_trash_hidden on public.app_notes as restrictive for all to authenticated
  using (deleted_at is null) with check (deleted_at is null);

-- 삭제 가로채기: basket·note 행에 표시만 하고 실제 삭제를 건너뛴다. work·diary, 영구 삭제(이미 휴지통 행), 딸린 cascade 삭제는 지금처럼 지운다.
create function private.app_trash_note_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null or old.kind not in ('basket', 'note') or pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_notes set deleted_at = pg_catalog.now() where id = old.id and deleted_at is null;
  return null;
end
$$;
revoke all on function private.app_trash_note_before_delete() from public, anon, authenticated, service_role;

create trigger app_notes_a_trash_before_delete
before delete on public.app_notes
for each row execute function private.app_trash_note_before_delete();

-- 휴지통 목록: 종류별로 소유한 작업공간만. 'project'·'library_folder'는 묶음의 맨 위 행만, 나머지('note' 포함)는 휴지통 행 전부.
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
  elsif p_kind = 'note' then
    -- 노트·업데이트(app_notes 종류 basket·note): 휴지통 행 전부. 본문 앞부분만 미리보기로 준다(소유자 본인에게만).
    return coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', 'note',
               'id', n.id,
               'workspace_id', n.workspace_id,
               'note_kind', n.kind,
               'title', n.title,
               'preview', pg_catalog.left(pg_catalog.regexp_replace(n.raw_text, '\s+', ' ', 'g'), 80),
               'occurred_at', n.occurred_at,
               'deleted_at', n.deleted_at,
               'file_count', case when pg_catalog.jsonb_typeof(n.attachments) = 'array' then pg_catalog.jsonb_array_length(n.attachments) else 0 end,
               'link_count', (select pg_catalog.count(*) from public.app_record_links l where l.note_id = n.id))
             order by n.deleted_at desc, n.id)
      from public.app_notes n
      where n.deleted_at is not null
        and private.app_is_workspace_owner(n.workspace_id)
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
  elsif p_kind = 'note' then
    -- 영구 삭제는 지금의 노트 지우기와 같다: 행을 지우면 연결 표의 cascade가 그 노트의 연결을 함께 지운다. Drive 파일은 건드리지 않는다.
    select n.workspace_id into v_ws from public.app_notes n
     where n.id = p_id and n.deleted_at is not null
     for update;
    if not found or not private.app_is_workspace_owner(v_ws) then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    delete from public.app_notes n where n.id = p_id and n.deleted_at is not null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'P0002', message = 'TRASH_NOT_FOUND';
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'kind', 'note', 'id', p_id);
  end if;
  raise exception using errcode = '22023', message = 'TRASH_KIND_UNKNOWN';
end
$$;
revoke all on function public.app_trash_purge(text, uuid) from public, anon, service_role;
grant execute on function public.app_trash_purge(text, uuid) to authenticated;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026100000', 'trash_notes_db', array['TRASH-다른삭제 4단계: app_notes deleted_at, delete-to-trash trigger (basket/note only), restrictive hide policy, app_trash_list/restore/purge kind note']);
commit;
