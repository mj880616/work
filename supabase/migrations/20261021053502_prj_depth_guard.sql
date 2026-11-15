begin;
-- PRJ-3단 DB 안전망 (docs/design/project-3-levels.md 4절, 사용자 승인 "넣기").
-- app_spaces의 위아래 관계(parent_id)를 3단까지만 허용하고, 자기 자신이나 자기 아래 프로젝트 밑으로 옮기는 저장을 거절한다.
-- 새 칸·표·정책·RLS·표 grant 변경 없음. 기존 행 변경 없음. 트리거 1개 + 트리거 함수 1개(SECURITY INVOKER, search_path 빈칸).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'PRJ_PARENT_CYCLE:' 또는 'PRJ_DEPTH_LIMIT:'.
-- 승인형 DB workflow는 create trigger를 허용하지 않으므로 SQL Editor(폰 경로 C) 전용. 짝: docs/20261021053502_prj_depth_guard.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 트리거 생성 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_spaces in share row exclusive mode;

-- 사전 조건이 다르거나, 이미 4단 이상·순환·끊긴 상위가 있으면 아무것도 바꾸지 않고 멈춘다(데이터를 고치지 않는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021053502')
     or exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_spaces') and tgname = 'app_spaces_depth_guard')
     or to_regprocedure('private.app_enforce_space_depth()') is not null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_spaces') and attname = 'parent_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_spaces') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_spaces') and relrowsecurity) then
    raise exception 'PRJ_DEPTH_GUARD_PREREQUISITE_CHANGED: schema differs; stop';
  end if;
  if exists (
    with recursive t(id, lvl, path) as (
      select s.id, 1, array[s.id] from public.app_spaces s where s.parent_id is null
      union all
      select s.id, t.lvl + 1, t.path || s.id
      from public.app_spaces s join t on s.parent_id = t.id
      where s.id <> all(t.path) and t.lvl < 10
    )
    select 1 from t where t.lvl > 3
    union all
    select 1 from public.app_spaces s where not exists (select 1 from t where t.id = s.id)
  ) then
    raise exception 'PRJ_DEPTH_GUARD_PREREQUISITE_CHANGED: depth over 3, cycle or broken parent exists; stop';
  end if;
end
$$;

create function private.app_enforce_space_depth()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cursor uuid := new.parent_id;
  v_above integer := 0;
  v_height integer;
begin
  -- 맨 위로 두기와 상위를 바꾸지 않는 수정은 검사하지 않는다(기존 데이터는 적용 전 3단 이하로 확인).
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  -- 같은 작업공간의 상위 바꾸기를 한 번에 하나씩: 동시에 서로를 아래로 옮겨 순환이 생기는 경우를 막는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_spaces_depth_guard:' || new.workspace_id::text, 0));
  -- 위로: 새 상위부터 맨 위까지. 자기 자신을 만나면 순환, 상위가 3개면 4단째가 된다(반복도 최대 3번).
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514',
        message = 'PRJ_PARENT_CYCLE: a project cannot be placed under itself or a project below it';
    end if;
    v_above := v_above + 1;
    if v_above >= 3 then
      raise exception using errcode = '23514', message = 'PRJ_DEPTH_LIMIT: projects are limited to 3 levels';
    end if;
    select s.parent_id into v_cursor from public.app_spaces s where s.id = v_cursor;
  end loop;
  -- 아래로: 옮기는 프로젝트를 1단으로 센 아래 단계 수(하위가 없으면 1). 4단까지만 따라간다.
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select s.id, d.lvl + 1, d.path || s.id
    from public.app_spaces s join d on s.parent_id = d.id
    where s.id <> all(d.path) and d.lvl < 4
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 3 then
    raise exception using errcode = '23514', message = 'PRJ_DEPTH_LIMIT: projects are limited to 3 levels';
  end if;
  return new;
end
$$;
revoke all on function private.app_enforce_space_depth() from public, anon, authenticated;

create trigger app_spaces_depth_guard
before insert or update of parent_id on public.app_spaces
for each row execute function private.app_enforce_space_depth();

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021053502', 'prj_depth_guard', array['PRJ-3단: app_spaces at most 3 levels and no cycle (trigger app_spaces_depth_guard)']);
commit;
