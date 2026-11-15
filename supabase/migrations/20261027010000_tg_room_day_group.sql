begin;
-- TG-방날짜묶기 1단계 DB (명진 결정 10/27 00:31, 설계 결정 7개 모두 추천대로).
-- 설계: docs/design/tg-room-day-group.md 5절·7절. 이 migration은 새 표 셋, 새 함수 아홉(비공개 도우미 하나 포함), 소식 표의 색인 하나만 만든다.
-- 소식 표(app_feed_items)의 칸·권한·정책·트리거·줄 내용은 한 글자도 바꾸지 않는다(색인만 더함).
-- 새 표 셋(모두 소유자 전용 RLS, anon·PUBLIC·service_role 표 권한 없음, 로그인한 본인은 읽기만. 쓰기는 아래 함수로만):
--   public.app_feed_folders    폴더. 방 하나는 폴더 하나. 이름 1~20자, 작업공간당 30개 이하, 같은 이름 불가.
--   public.app_feed_rooms      방 상태. 폴더·보관(방 전체, 앞으로 올 날 포함). 수집·요약은 보관해도 계속된다.
--   public.app_feed_room_days  방·날 상태와 하루 요약. parts = 묶음별 요약 배열, hidden_at = 그날 그 줄만 삭제(휴지통, 자동으로 비우지 않음).
-- 새 함수:
--   private.app_feed_owner_workspace()                         비공개 도우미(아무도 직접 못 부름). 로그인한 본인이 소유자인 작업공간 하나를 돌려준다.
--   app_feed_room_touch(p_workspace, p_room_key, p_room_label, p_chat_kind, p_chat_username)   서버 전용(service_role). 방 줄 자동 만들기·이름·종류·@아이디 갱신. 폴더·보관은 건드리지 않는다.
--   app_feed_room_day_add(p_workspace, p_room_key, p_day, p_part)   서버 전용(service_role). 하루 요약 한 묶음을 더한다. 같은 batch는 무시(멱등). 삭제된 날의 삭제 표시는 유지.
--   app_feed_room_set(p_room_key, p_folder, p_archived)       화면(소유자). 방의 폴더·보관 상태를 통째로 정한다(둘 다 새 값을 넘긴다. 폴더 없음 = null, 보관 해제 = false).
--   app_feed_room_day_set(p_room_key, p_day, p_state)         화면(소유자). 'active' | 'trashed'. 그날 그 줄만. 되살리기 가능.
--   app_feed_folder_create(p_name) / app_feed_folder_rename(p_id, p_name) / app_feed_folder_delete(p_id)   화면(소유자). 폴더를 지우면 안의 방은 폴더 없음으로 돌아오고 방·소식·요약은 그대로.
--   app_feed_room_day_lines(p_from, p_to)                     읽기용 목록(소유자, SECURITY INVOKER라 소유자 RLS 그대로). 방·날마다 한 줄. 날 범위 93일 이하.
-- 읽기 뷰 대신 INVOKER 함수를 쓰는 이유: 승인형 DB workflow 확장 규칙은 CREATE VIEW를 받지 않는다(unknown-statement). 함수는 권한을 높이지 않고 RLS가 그대로 적용된다.
-- 모든 DEFINER 함수는 빈 search_path, PUBLIC·anon 실행권 없음. 입력 검사(방 번호 정규식, 폴더 이름, 줄 수·글자 수, 날짜)는 함수 안에서 한 번 더 한다.
-- 안 하는 것: 기존 표·정책·권한·트리거·함수 변경, anon·PUBLIC 권한, RLS 약화, 행 삭제 권한(폴더 행 삭제는 함수 안에서만), rtw_* 객체, 소식 표 데이터 변경.
-- 앞 단계: 20261024140000(call_tg_feed)이 먼저 적용돼 있어야 한다(소식 표 app_feed_items).
-- 짝: docs/20261027010000_tg_room_day_group.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027010000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_feed_folders') is not null
     or to_regclass('public.app_feed_rooms') is not null
     or to_regclass('public.app_feed_room_days') is not null
     or to_regclass('public.app_feed_items_tg_room_day_idx') is not null
     or to_regprocedure('private.app_feed_owner_workspace()') is not null
     or to_regprocedure('public.app_feed_room_touch(uuid,text,text,text,text)') is not null
     or to_regprocedure('public.app_feed_room_day_add(uuid,text,date,jsonb)') is not null
     or to_regprocedure('public.app_feed_room_set(text,uuid,boolean)') is not null
     or to_regprocedure('public.app_feed_room_day_set(text,date,text)') is not null
     or to_regprocedure('public.app_feed_folder_create(text)') is not null
     or to_regprocedure('public.app_feed_folder_rename(uuid,text)') is not null
     or to_regprocedure('public.app_feed_folder_delete(uuid)') is not null
     or to_regprocedure('public.app_feed_room_day_lines(date,date)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TG_ROOM_DAY_GROUP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_feed_folders_name_check check (char_length(name) between 1 and 20 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_feed_folders_workspace_name_key unique (workspace_id, name),
  constraint app_feed_folders_workspace_id_key unique (workspace_id, id)
);

create table public.app_feed_rooms (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  room_key text not null,
  room_label text,
  chat_kind text,
  chat_username text,
  folder_id uuid references public.app_feed_folders(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_feed_rooms_pkey primary key (workspace_id, room_key),
  constraint app_feed_rooms_room_key_check check (room_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint app_feed_rooms_room_label_check check (room_label is null or (char_length(btrim(room_label)) between 1 and 100 and room_label !~ '[[:cntrl:]]')),
  constraint app_feed_rooms_chat_kind_check check (chat_kind is null or chat_kind in ('user', 'group', 'channel')),
  constraint app_feed_rooms_chat_username_check check (chat_username is null or chat_username ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$')
);
create index app_feed_rooms_folder_idx on public.app_feed_rooms(workspace_id, folder_id) where folder_id is not null;

create table public.app_feed_room_days (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  room_key text not null,
  day date not null,
  parts jsonb not null default '[]'::jsonb,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint app_feed_room_days_pkey primary key (workspace_id, room_key, day),
  constraint app_feed_room_days_room_key_check check (room_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint app_feed_room_days_parts_check check (jsonb_typeof(parts) = 'array' and jsonb_array_length(parts) <= 50 and octet_length(parts::text) <= 40000)
);

-- 소식 표는 색인만 더한다(방·날 목록용). 칸·권한·정책·내용은 그대로.
create index app_feed_items_tg_room_day_idx on public.app_feed_items(workspace_id, day desc, room_key) where source = 'telegram';

alter table public.app_feed_folders enable row level security;
alter table public.app_feed_rooms enable row level security;
alter table public.app_feed_room_days enable row level security;
revoke all on table public.app_feed_folders from public, anon, authenticated, service_role;
revoke all on table public.app_feed_rooms from public, anon, authenticated, service_role;
revoke all on table public.app_feed_room_days from public, anon, authenticated, service_role;
grant select on table public.app_feed_folders to authenticated;
grant select on table public.app_feed_rooms to authenticated;
grant select on table public.app_feed_room_days to authenticated;
create policy feed_folders_owner_read on public.app_feed_folders for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy feed_rooms_owner_read on public.app_feed_rooms for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy feed_room_days_owner_read on public.app_feed_room_days for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 비공개 도우미: 로그인한 본인이 소유자인 작업공간 하나. 아니면 TGDG_NOT_FOUND.
create function private.app_feed_owner_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if (select pg_catalog.count(*) from public.app_workspace_members m
        where m.user_id = (select auth.uid()) and m.role = 'owner') <> 1 then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  select m.workspace_id into ws from public.app_workspace_members m
    where m.user_id = (select auth.uid()) and m.role = 'owner';
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  return ws;
end
$$;

-- 서버 입구용. 소식 저장 뒤에 부르고, 실패해도 소식 저장은 막지 않는다(서버 단계 규칙). 그 방의 텔레그램 소식이 실제로 있을 때만 받는다.
create function public.app_feed_room_touch(p_workspace uuid, p_room_key text, p_room_label text, p_chat_kind text, p_chat_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lbl text;
  n integer;
begin
  if p_workspace is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  lbl := pg_catalog.btrim(coalesce(p_room_label, ''));
  if lbl = '' then lbl := null;
  elsif pg_catalog.char_length(lbl) > 100 or lbl ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TGDG_LABEL'; end if;
  if p_chat_kind is not null and p_chat_kind not in ('user', 'group', 'channel') then
    raise exception using errcode = '22023', message = 'TGDG_CHAT_KIND';
  end if;
  if p_chat_username is not null and p_chat_username !~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then
    raise exception using errcode = '22023', message = 'TGDG_CHAT_USERNAME';
  end if;
  if not exists (select 1 from public.app_workspaces w where w.id = p_workspace) then
    raise exception using errcode = '22023', message = 'TGDG_WORKSPACE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_rooms:' || p_workspace::text, 0));
  if not exists (select 1 from public.app_feed_items i where i.workspace_id = p_workspace and i.source = 'telegram' and i.room_key = p_room_key) then
    raise exception using errcode = 'P0002', message = 'TGDG_NO_ROOM';
  end if;
  insert into public.app_feed_rooms as r (workspace_id, room_key, room_label, chat_kind, chat_username)
  values (p_workspace, p_room_key, lbl, p_chat_kind, p_chat_username)
  on conflict (workspace_id, room_key) do update
    set room_label = coalesce(excluded.room_label, r.room_label),
        chat_kind = coalesce(excluded.chat_kind, r.chat_kind),
        chat_username = coalesce(excluded.chat_username, r.chat_username),
        updated_at = pg_catalog.now()
    where excluded.room_label is distinct from r.room_label and excluded.room_label is not null
       or excluded.chat_kind is distinct from r.chat_kind and excluded.chat_kind is not null
       or excluded.chat_username is distinct from r.chat_username and excluded.chat_username is not null;
  get diagnostics n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', n > 0);
end
$$;

-- 서버 입구용. p_part = {batch, first_at, headline?, lines[1~4], open_ref?}. 같은 batch가 이미 있으면 아무것도 바꾸지 않는다.
-- 삭제 표시(hidden_at)는 건드리지 않는다("그날 그 줄만" 삭제 상태 유지).
create function public.app_feed_room_day_add(p_workspace uuid, p_room_key text, p_day date, p_part jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b text;
  ft timestamptz;
  hl text;
  ln jsonb;
  s text;
  orf text;
  part jsonb;
  n integer;
begin
  if p_workspace is null or p_day is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  if p_part is null or pg_catalog.jsonb_typeof(p_part) <> 'object'
     or pg_catalog.jsonb_path_exists(p_part, '$.keyvalue() ? (@.key != "batch" && @.key != "first_at" && @.key != "headline" && @.key != "lines" && @.key != "open_ref")') then
    raise exception using errcode = '22023', message = 'TGDG_PART';
  end if;
  if pg_catalog.jsonb_typeof(p_part -> 'batch') is distinct from 'string' or (p_part ->> 'batch') !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_PART_BATCH';
  end if;
  b := p_part ->> 'batch';
  if pg_catalog.jsonb_typeof(p_part -> 'first_at') is distinct from 'string'
     or (p_part ->> 'first_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = '22023', message = 'TGDG_PART_TIME';
  end if;
  ft := (p_part ->> 'first_at')::timestamptz;
  hl := '';
  if pg_catalog.jsonb_typeof(p_part -> 'headline') = 'string' then
    hl := pg_catalog.btrim(p_part ->> 'headline');
    if pg_catalog.char_length(hl) > 60 or hl ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TGDG_PART_HEADLINE'; end if;
  elsif pg_catalog.jsonb_exists(p_part, 'headline') and pg_catalog.jsonb_typeof(p_part -> 'headline') <> 'null' then
    raise exception using errcode = '22023', message = 'TGDG_PART_HEADLINE';
  end if;
  ln := p_part -> 'lines';
  if pg_catalog.jsonb_typeof(ln) is distinct from 'array' or pg_catalog.jsonb_array_length(ln) not between 1 and 4 then
    raise exception using errcode = '22023', message = 'TGDG_PART_LINES';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(ln) as t(x) where pg_catalog.jsonb_typeof(t.x) <> 'string') then
    raise exception using errcode = '22023', message = 'TGDG_PART_LINES';
  end if;
  for s in select pg_catalog.btrim(x) from pg_catalog.jsonb_array_elements_text(ln) as t(x) loop
    if pg_catalog.char_length(s) not between 1 and 100 or s ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'TGDG_PART_LINES';
    end if;
  end loop;
  orf := null;
  if pg_catalog.jsonb_typeof(p_part -> 'open_ref') = 'string' then
    orf := p_part ->> 'open_ref';
    if orf !~ '^[A-Za-z0-9_.:@/-]{1,100}$' then raise exception using errcode = '22023', message = 'TGDG_PART_OPEN_REF'; end if;
  elsif pg_catalog.jsonb_exists(p_part, 'open_ref') and pg_catalog.jsonb_typeof(p_part -> 'open_ref') <> 'null' then
    raise exception using errcode = '22023', message = 'TGDG_PART_OPEN_REF';
  end if;
  if not exists (select 1 from public.app_workspaces w where w.id = p_workspace) then
    raise exception using errcode = '22023', message = 'TGDG_WORKSPACE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_room_days:' || p_workspace::text, 0));
  if not exists (select 1 from public.app_feed_items i where i.workspace_id = p_workspace and i.source = 'telegram' and i.room_key = p_room_key and i.day = p_day) then
    raise exception using errcode = 'P0002', message = 'TGDG_NO_ROOM_DAY';
  end if;
  if (select pg_catalog.jsonb_array_length(d.parts) from public.app_feed_room_days d
        where d.workspace_id = p_workspace and d.room_key = p_room_key and d.day = p_day) >= 50 then
    raise exception using errcode = '22023', message = 'TGDG_PARTS_FULL';
  end if;
  part := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'batch', b,
    'first_at', pg_catalog.to_char(ft at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'headline', hl,
    'lines', (select pg_catalog.jsonb_agg(pg_catalog.btrim(x)) from pg_catalog.jsonb_array_elements_text(ln) as t(x)),
    'open_ref', orf));
  insert into public.app_feed_room_days as d (workspace_id, room_key, day, parts)
  values (p_workspace, p_room_key, p_day, pg_catalog.jsonb_build_array(part))
  on conflict (workspace_id, room_key, day) do update
    set parts = d.parts || excluded.parts, updated_at = pg_catalog.now()
    where not (d.parts @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('batch', b)));
  get diagnostics n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'added', n > 0);
end
$$;

-- 화면용. 방의 폴더·보관 상태를 통째로 정한다. 그 방의 텔레그램 소식이 실제로 있을 때만(없는 방 번호 지어내기 방지).
create function public.app_feed_room_set(p_room_key text, p_folder uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  lbl text;
  cur public.app_feed_rooms;
  want_arch timestamptz;
  changed boolean := false;
begin
  if p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' or p_archived is null then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_rooms:' || ws::text, 0));
  select i.room_label into lbl from public.app_feed_items i
    where i.workspace_id = ws and i.source = 'telegram' and i.room_key = p_room_key
    order by i.occurred_at desc limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  if p_folder is not null and not exists (select 1 from public.app_feed_folders f where f.id = p_folder and f.workspace_id = ws) then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  select * into cur from public.app_feed_rooms r where r.workspace_id = ws and r.room_key = p_room_key;
  if not found then
    insert into public.app_feed_rooms (workspace_id, room_key, room_label, folder_id, archived_at)
    values (ws, p_room_key, lbl, p_folder, case when p_archived then pg_catalog.now() end);
    changed := p_folder is not null or p_archived;
  else
    want_arch := case when p_archived then coalesce(cur.archived_at, pg_catalog.now()) end;
    if cur.folder_id is distinct from p_folder or cur.archived_at is distinct from want_arch then
      update public.app_feed_rooms r set folder_id = p_folder, archived_at = want_arch, updated_at = pg_catalog.now()
        where r.workspace_id = ws and r.room_key = p_room_key;
      changed := true;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', changed, 'room_key', p_room_key, 'folder_id', p_folder, 'archived', p_archived);
end
$$;

-- 화면용. 그날 그 줄만 삭제('trashed') 또는 되살리기('active'). 방과 소식은 그대로. 자동으로 비우지 않는다.
create function public.app_feed_room_day_set(p_room_key text, p_day date, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  cur timestamptz;
  have boolean;
  changed boolean := false;
begin
  if p_room_key is null or p_day is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' or p_state is null or p_state not in ('active', 'trashed') then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_room_days:' || ws::text, 0));
  if not exists (select 1 from public.app_feed_items i where i.workspace_id = ws and i.source = 'telegram' and i.room_key = p_room_key and i.day = p_day) then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  select d.hidden_at, true into cur, have from public.app_feed_room_days d
    where d.workspace_id = ws and d.room_key = p_room_key and d.day = p_day;
  if not coalesce(have, false) then
    insert into public.app_feed_room_days (workspace_id, room_key, day, hidden_at)
    values (ws, p_room_key, p_day, case when p_state = 'trashed' then pg_catalog.now() end);
    changed := p_state = 'trashed';
  elsif (p_state = 'trashed') is distinct from (cur is not null) then
    update public.app_feed_room_days d
      set hidden_at = case when p_state = 'trashed' then pg_catalog.now() end, updated_at = pg_catalog.now()
      where d.workspace_id = ws and d.room_key = p_room_key and d.day = p_day;
    changed := true;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', changed, 'room_key', p_room_key, 'day', p_day, 'state', p_state);
end
$$;

create function public.app_feed_folder_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  nm text;
  fid uuid;
begin
  nm := pg_catalog.btrim(coalesce(p_name, ''));
  if pg_catalog.char_length(nm) not between 1 and 20 or nm ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TGDG_FOLDER_NAME';
  end if;
  ws := private.app_feed_owner_workspace();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_folders:' || ws::text, 0));
  if (select pg_catalog.count(*) from public.app_feed_folders f where f.workspace_id = ws) >= 30 then
    raise exception using errcode = '22023', message = 'TGDG_FOLDER_LIMIT';
  end if;
  if exists (select 1 from public.app_feed_folders f where f.workspace_id = ws and f.name = nm) then
    raise exception using errcode = '23505', message = 'TGDG_FOLDER_NAME_TAKEN';
  end if;
  insert into public.app_feed_folders (workspace_id, name, sort_order)
  values (ws, nm, coalesce((select pg_catalog.max(f.sort_order) from public.app_feed_folders f where f.workspace_id = ws), 0) + 1)
  returning id into fid;
  return pg_catalog.jsonb_build_object('ok', true, 'id', fid, 'name', nm);
end
$$;

create function public.app_feed_folder_rename(p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  nm text;
  cur text;
begin
  nm := pg_catalog.btrim(coalesce(p_name, ''));
  if p_id is null or pg_catalog.char_length(nm) not between 1 and 20 or nm ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TGDG_FOLDER_NAME';
  end if;
  ws := private.app_feed_owner_workspace();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_folders:' || ws::text, 0));
  select f.name into cur from public.app_feed_folders f where f.id = p_id and f.workspace_id = ws;
  if not found then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  if cur = nm then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'id', p_id, 'name', nm);
  end if;
  if exists (select 1 from public.app_feed_folders f where f.workspace_id = ws and f.name = nm and f.id <> p_id) then
    raise exception using errcode = '23505', message = 'TGDG_FOLDER_NAME_TAKEN';
  end if;
  update public.app_feed_folders f set name = nm where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'id', p_id, 'name', nm);
end
$$;

-- 폴더 행만 지운다. 안의 방은 폴더 없음으로 돌아오고 방·소식·요약은 그대로.
create function public.app_feed_folder_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  moved integer;
begin
  if p_id is null then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_folders:' || ws::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_rooms:' || ws::text, 0));
  if not exists (select 1 from public.app_feed_folders f where f.id = p_id and f.workspace_id = ws) then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  update public.app_feed_rooms r set folder_id = null, updated_at = pg_catalog.now() where r.workspace_id = ws and r.folder_id = p_id;
  get diagnostics moved = row_count;
  delete from public.app_feed_folders f where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'rooms_released', moved);
end
$$;

-- 읽기용 목록. SECURITY INVOKER: 소식 표·새 표의 소유자 RLS가 그대로 적용된다(소유자가 아니면 빈 결과).
-- 방·날마다 한 줄. 지우지 않은 소식이 하나라도 있는 날만. 보관한 방·삭제한 날은 그대로 돌려주고(archived_at, day_hidden_at) 걸러내기는 화면 쿼리가 한다.
-- headline = 가장 이른 묶음 중 글이 있는 첫 headline(없으면 null). 날 범위는 p_from <= p_to, 93일 이하.
create function public.app_feed_room_day_lines(p_from date, p_to date)
returns table (
  room_key text, room_label text, day date, last_at timestamptz, item_count integer, raw_count integer,
  headline text, part_count integer, chat_kind text, chat_username text, folder_id uuid, archived_at timestamptz, day_hidden_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception using errcode = '22023', message = 'TGDG_RANGE';
  end if;
  return query
  with g as (
    select i.workspace_id, i.room_key, i.day,
           pg_catalog.max(i.occurred_at) as last_at,
           (pg_catalog.count(*) filter (where i.hidden_at is null))::integer as item_count,
           (coalesce(pg_catalog.sum(i.raw_count) filter (where i.hidden_at is null), 0))::integer as raw_count,
           (pg_catalog.array_agg(i.room_label order by i.occurred_at desc))[1] as lbl
      from public.app_feed_items i
     where i.source = 'telegram' and i.day between p_from and p_to
     group by i.workspace_id, i.room_key, i.day
    having pg_catalog.count(*) filter (where i.hidden_at is null) > 0)
  select g.room_key,
         coalesce(r.room_label, g.lbl),
         g.day, g.last_at, g.item_count, g.raw_count,
         (select s.h from (select nullif(p ->> 'headline', '') as h from pg_catalog.jsonb_array_elements(coalesce(d.parts, '[]'::jsonb)) as t(p)
                            order by p ->> 'first_at') s where s.h is not null limit 1),
         pg_catalog.jsonb_array_length(coalesce(d.parts, '[]'::jsonb)),
         r.chat_kind, r.chat_username, r.folder_id, r.archived_at, d.hidden_at
    from g
    left join public.app_feed_rooms r on r.workspace_id = g.workspace_id and r.room_key = g.room_key
    left join public.app_feed_room_days d on d.workspace_id = g.workspace_id and d.room_key = g.room_key and d.day = g.day
   order by g.day desc, g.last_at desc, g.room_key;
end
$$;

revoke all on function private.app_feed_owner_workspace() from public, anon, authenticated, service_role;
revoke all on function public.app_feed_room_touch(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_room_day_add(uuid, text, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_room_set(text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_room_day_set(text, date, text) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_folder_create(text) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_folder_rename(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_folder_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_feed_room_day_lines(date, date) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_room_touch(uuid, text, text, text, text) to service_role;
grant execute on function public.app_feed_room_day_add(uuid, text, date, jsonb) to service_role;
grant execute on function public.app_feed_room_set(text, uuid, boolean) to authenticated;
grant execute on function public.app_feed_room_day_set(text, date, text) to authenticated;
grant execute on function public.app_feed_folder_create(text) to authenticated;
grant execute on function public.app_feed_folder_rename(uuid, text) to authenticated;
grant execute on function public.app_feed_folder_delete(uuid) to authenticated;
grant execute on function public.app_feed_room_day_lines(date, date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027010000', 'tg_room_day_group', array['TG-방날짜묶기 1단계: new tables app_feed_folders, app_feed_rooms, app_feed_room_days (owner RLS select-only for authenticated, no anon/PUBLIC/service_role table privileges); one partial index on app_feed_items; private owner helper and seven SECURITY DEFINER functions with empty search_path (room_touch and room_day_add: service_role only; room_set, room_day_set, folder create/rename/delete: authenticated with owner check); one SECURITY INVOKER list function app_feed_room_day_lines; no change to existing columns, policies, grants, triggers or rows']);
commit;
