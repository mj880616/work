begin;
-- 20261027050000_trash_share_pages_db의 짝 되돌리기. 공유 페이지의 휴지통 트리거·숨김 정책·검사 제약·트리거 함수·색인·deleted_at·deleted_status 칸과 이번 기록 1행을 지우고,
-- 휴지통 RPC 3개를 앞 단계(20261026100000: 프로젝트·담당조직·사업 보고·자료실 폴더·노트) 원문으로 되돌린다.
-- 다른 휴지통 종류, 공유 페이지·링크·사진 기록 행, 기존 정책(share_pages_owner_all)은 건드리지 않는다.
-- 먼저 휴지통에 있던 공유 페이지는 되돌리기 전에 지워지지 않고 넣기 전 상태(초안·게시·보관)로 복원된 뒤 표시 칸이 사라진다: 게시였으면 같은 링크가 다시 열린다.
-- 되돌린 뒤의 공유 페이지 [삭제]는 적용 전처럼 서버 함수 purge_page로 바로 지운다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 트리거·정책 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261027050000' and name = 'trash_share_pages_db') <> 1 then
    raise exception 'TRASH_SHARE_PAGES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

-- 휴지통에 있는 공유 페이지는 넣기 전 상태로 복원한다(칸을 없애면 표시 없이 'archived'로 남아 보관함에 섞이므로).
update public.app_share_pages set status = deleted_status where deleted_at is not null and deleted_status is not null;

drop trigger if exists app_share_pages_a_trash_before_delete on public.app_share_pages;
drop policy if exists app_share_pages_trash_hidden on public.app_share_pages;
drop function if exists private.app_trash_share_page_before_delete();
drop index if exists public.app_share_pages_trash_idx;
alter table public.app_share_pages drop constraint if exists app_share_pages_trash_check;
alter table public.app_share_pages drop column if exists deleted_at, drop column if exists deleted_status;

-- 휴지통 함수 3개: 20261026100000 원문(프로젝트·담당조직·사업 보고·자료실 폴더·노트)으로 되돌린다. 같은 서명이라 실행권(authenticated만)은 그대로 유지된다.
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
delete from supabase_migrations.schema_migrations
 where version = '20261027050000' and name = 'trash_share_pages_db';
commit;
