begin;
-- 20261025100000_trash_org_report_db의 짝 되돌리기. 담당조직·사업 보고의 휴지통 트리거·숨김 정책·트리거 함수 2개·색인·deleted_at 칸과 이번 기록 1행을 지우고,
-- 휴지통 RPC 3개를 프로젝트 전용 모양(20261024193000 원문)으로 되돌린다.
-- 프로젝트 휴지통(app_spaces)·행·연결·기존 정책·기존 트리거는 건드리지 않는다.
-- 되돌린 순간 휴지통에 있던 담당조직·사업 보고는 지워지지 않고 원래 자리에 다시 보인다(표시 칸이 없어지므로). 자료는 잃지 않는다.
-- 되돌린 뒤의 [삭제]는 적용 전처럼 바로 지운다(연결 표의 cascade·set null 포함).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 트리거·정책 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganizations, public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261025100000' and name = 'trash_org_report_db') <> 1 then
    raise exception 'TRASH_ORG_REPORT_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger if exists app_suborganizations_a_trash_before_delete on public.app_suborganizations;
drop trigger if exists app_meetings_a_trash_before_delete on public.app_meetings;
drop policy if exists app_suborganizations_trash_hidden on public.app_suborganizations;
drop policy if exists app_meetings_trash_hidden on public.app_meetings;
drop function if exists private.app_trash_org_before_delete();
drop function if exists private.app_trash_report_before_delete();
drop index if exists public.app_suborganizations_trash_idx;
drop index if exists public.app_meetings_trash_idx;
alter table public.app_suborganizations drop column if exists deleted_at;
alter table public.app_meetings drop column if exists deleted_at;

-- 휴지통 RPC 3개: 20261024193000 원문(프로젝트 전용)으로 되돌린다. 같은 서명이라 실행권(authenticated만)은 그대로 유지된다.
create or replace function public.app_trash_list(p_kind text)
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

create or replace function public.app_trash_restore(p_kind text, p_id uuid)
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

create or replace function public.app_trash_purge(p_kind text, p_id uuid)
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

revoke all on function public.app_trash_list(text) from public, anon, service_role;
revoke all on function public.app_trash_restore(text, uuid) from public, anon, service_role;
revoke all on function public.app_trash_purge(text, uuid) from public, anon, service_role;

delete from supabase_migrations.schema_migrations
  where version = '20261025100000' and name = 'trash_org_report_db';
commit;
