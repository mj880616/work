begin;
-- TG-발언자이름 1단계 DB (명진 10/26 21:26: 텔레그램 소식 원문에서 A·B 대신 보낸 사람 이름을 보이게 한다).
-- 설계: docs/design/telegram-sender-names.md (#1284). 이 migration은 새 표 둘과 함수 넷만 만든다. 소식 원문(app_feed_items.raw_text)은 한 글자도 바꾸지 않는다.
-- 새 표 둘(둘 다 소유자 전용 RLS, anon·PUBLIC·service_role 표 권한 없음, 로그인한 본인은 읽기만. 쓰기는 아래 함수로만):
--   public.app_tg_senders      사람 한 줄. sender_key = 앱 스크립트가 비밀 열쇠(HMAC)로 섞은 고정 해시(번호 원문 칸은 없다). name = 명진이 붙인 이름(이기는 값),
--                              auto_name = 수집기가 보낸 이름, is_self = 수집기가 "내가 보냄"이라고 적은 사람(화면이 "나"로 표시).
--   public.app_tg_day_senders  방(room_key)·날짜(day)·라벨(A~ZZZ)이 어느 사람인지. 라벨 연결이 있어야 원문 줄의 A에 이름을 입힐 수 있다.
-- 새 함수 넷(모두 SECURITY DEFINER, 빈 search_path, PUBLIC·anon 실행권 없음):
--   app_tg_senders_upsert(p_workspace, p_room_key, p_day, p_senders)  서버 입구(service_role만). 사람·연결을 더한다. 이미 있는 연결은 바꾸지 않는다.
--   app_tg_sender_set_name(p_room_key, p_day, p_label, p_name)        화면(authenticated, 안에서 소유자 확인). 그 방·날짜·라벨의 사람에게 이름을 붙이거나(빈 글=지움) 없으면 새로 만든다.
--   app_tg_sender_merge(p_from, p_to)                                  화면(소유자). 같은 사람이 둘로 갈라졌을 때 합친다. 되돌릴 수 없다.
--   app_tg_sender_forget(p_id)                                         화면(소유자). 사람 한 줄과 연결을 지운다. 소식 글은 영향 없다.
-- 안 하는 것: 기존 표·정책·권한·트리거·함수 변경, anon·PUBLIC 권한, RLS 약화, 번호 원문 저장, 기존 줄 변경, rtw_* 객체.
-- 앞 단계: 20261024140000(call_tg_feed)이 먼저 적용돼 있어야 한다(소식 표 app_feed_items).
-- 짝: docs/20261026190000_tg_sender_names.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026190000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_tg_senders') is not null
     or to_regclass('public.app_tg_day_senders') is not null
     or to_regprocedure('public.app_tg_senders_upsert(uuid,text,date,jsonb)') is not null
     or to_regprocedure('public.app_tg_sender_set_name(text,date,text,text)') is not null
     or to_regprocedure('public.app_tg_sender_merge(uuid,uuid)') is not null
     or to_regprocedure('public.app_tg_sender_forget(uuid)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TG_SENDER_NAMES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_tg_senders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  sender_key text,
  name text,
  auto_name text,
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_tg_senders_key_check check (sender_key is null or sender_key ~ '^[0-9a-f]{16,32}$'),
  constraint app_tg_senders_name_check check (name is null or (char_length(name) between 1 and 40 and name !~ '[[:cntrl:]]')),
  constraint app_tg_senders_auto_name_check check (auto_name is null or (char_length(auto_name) between 1 and 40 and auto_name !~ '[[:cntrl:]]')),
  constraint app_tg_senders_workspace_id_key unique (workspace_id, id)
);
create unique index app_tg_senders_key_idx on public.app_tg_senders(workspace_id, sender_key) where sender_key is not null;

create table public.app_tg_day_senders (
  workspace_id uuid not null,
  room_key text not null,
  day date not null,
  label text not null,
  sender_id uuid not null,
  created_at timestamptz not null default now(),
  constraint app_tg_day_senders_pkey primary key (workspace_id, room_key, day, label),
  constraint app_tg_day_senders_sender_fkey foreign key (workspace_id, sender_id)
    references public.app_tg_senders(workspace_id, id) on delete cascade,
  constraint app_tg_day_senders_room_key_check check (room_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint app_tg_day_senders_label_check check (label ~ '^[A-Z]{1,3}$')
);
create index app_tg_day_senders_sender_idx on public.app_tg_day_senders(workspace_id, sender_id);

alter table public.app_tg_senders enable row level security;
alter table public.app_tg_day_senders enable row level security;
revoke all on table public.app_tg_senders from public, anon, authenticated, service_role;
revoke all on table public.app_tg_day_senders from public, anon, authenticated, service_role;
grant select on table public.app_tg_senders to authenticated;
grant select on table public.app_tg_day_senders to authenticated;
create policy tg_senders_owner_read on public.app_tg_senders for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy tg_day_senders_owner_read on public.app_tg_day_senders for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 서버 입구용. senders = [{label, key?, name?, self?}] (40명 이하). 소식 저장 뒤에 부르고, 실패해도 소식 저장은 막지 않는다(서버 단계 규칙).
create function public.app_tg_senders_upsert(p_workspace uuid, p_room_key text, p_day date, p_senders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  lbl text;
  k text;
  nm text;
  slf boolean;
  sid uuid;
  cur uuid;
  seen text[] := array[]::text[];
  n_people integer := 0;
  n_linked integer := 0;
  n_conflict integer := 0;
begin
  if p_workspace is null or p_day is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  if not exists (select 1 from public.app_workspaces w where w.id = p_workspace) then
    raise exception using errcode = '22023', message = 'TG_SENDER_WORKSPACE';
  end if;
  if p_senders is null or pg_catalog.jsonb_typeof(p_senders) <> 'array' or pg_catalog.jsonb_array_length(p_senders) > 40 then
    raise exception using errcode = '22023', message = 'TG_SENDER_LIST';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_tg_senders:' || p_workspace::text, 0));

  for e in select x from pg_catalog.jsonb_array_elements(p_senders) as t(x) loop
    if pg_catalog.jsonb_typeof(e) <> 'object'
       or pg_catalog.jsonb_path_exists(e, '$.keyvalue() ? (@.key != "label" && @.key != "key" && @.key != "name" && @.key != "self")') then
      raise exception using errcode = '22023', message = 'TG_SENDER_ITEM';
    end if;
    if pg_catalog.jsonb_typeof(e -> 'label') is distinct from 'string' or (e ->> 'label') !~ '^[A-Z]{1,3}$' then
      raise exception using errcode = '22023', message = 'TG_SENDER_LABEL';
    end if;
    lbl := e ->> 'label';
    if lbl = any (seen) then
      raise exception using errcode = '22023', message = 'TG_SENDER_LABEL';
    end if;
    seen := pg_catalog.array_append(seen, lbl);

    k := null;
    if pg_catalog.jsonb_typeof(e -> 'key') = 'string' then
      k := e ->> 'key';
      if k !~ '^[0-9a-f]{16,32}$' then raise exception using errcode = '22023', message = 'TG_SENDER_KEY'; end if;
    elsif pg_catalog.jsonb_typeof(e -> 'key') not in ('null') and pg_catalog.jsonb_exists(e, 'key') then
      raise exception using errcode = '22023', message = 'TG_SENDER_KEY';
    end if;

    nm := null;
    if pg_catalog.jsonb_typeof(e -> 'name') = 'string' then
      nm := pg_catalog.btrim(e ->> 'name');
      if nm = '' then nm := null;
      elsif pg_catalog.char_length(nm) > 40 or nm ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TG_SENDER_NAME'; end if;
    elsif pg_catalog.jsonb_typeof(e -> 'name') not in ('null') and pg_catalog.jsonb_exists(e, 'name') then
      raise exception using errcode = '22023', message = 'TG_SENDER_NAME';
    end if;

    slf := null;
    if pg_catalog.jsonb_typeof(e -> 'self') = 'boolean' then
      slf := (e ->> 'self')::boolean;
    elsif pg_catalog.jsonb_typeof(e -> 'self') not in ('null') and pg_catalog.jsonb_exists(e, 'self') then
      raise exception using errcode = '22023', message = 'TG_SENDER_SELF';
    end if;

    select l.sender_id into cur from public.app_tg_day_senders l
      where l.workspace_id = p_workspace and l.room_key = p_room_key and l.day = p_day and l.label = lbl;

    if k is not null then
      insert into public.app_tg_senders as s (workspace_id, sender_key, auto_name, is_self)
      values (p_workspace, k, nm, coalesce(slf, false))
      on conflict (workspace_id, sender_key) where sender_key is not null
      do update set auto_name = coalesce(excluded.auto_name, s.auto_name),
                    is_self = coalesce(slf, s.is_self),
                    updated_at = pg_catalog.now()
        where s.workspace_id = p_workspace
      returning s.id into sid;
      n_people := n_people + 1;
      if cur is null then
        insert into public.app_tg_day_senders (workspace_id, room_key, day, label, sender_id)
        values (p_workspace, p_room_key, p_day, lbl, sid);
        n_linked := n_linked + 1;
      elsif cur <> sid then
        n_conflict := n_conflict + 1;
      end if;
    elsif cur is null then
      insert into public.app_tg_senders (workspace_id, auto_name, is_self)
      values (p_workspace, nm, coalesce(slf, false))
      returning id into sid;
      insert into public.app_tg_day_senders (workspace_id, room_key, day, label, sender_id)
      values (p_workspace, p_room_key, p_day, lbl, sid);
      n_people := n_people + 1;
      n_linked := n_linked + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'people', n_people, 'linked', n_linked, 'conflicts', n_conflict);
end
$$;

-- 화면용. 로그인한 본인이 소유자인 작업공간 하나에서만 동작한다(소유 작업공간이 하나가 아니면 거절).
create function public.app_tg_sender_set_name(p_room_key text, p_day date, p_label text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  nm text;
  sid uuid;
begin
  if p_room_key is null or p_day is null or p_label is null
     or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' or p_label !~ '^[A-Z]{1,3}$' then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  nm := pg_catalog.btrim(coalesce(p_name, ''));
  if nm = '' then nm := null;
  elsif pg_catalog.char_length(nm) > 40 or nm ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TG_SENDER_NAME';
  end if;

  if (select pg_catalog.count(*) from public.app_workspace_members m
        where m.user_id = (select auth.uid()) and m.role = 'owner') <> 1 then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  select m.workspace_id into ws from public.app_workspace_members m
    where m.user_id = (select auth.uid()) and m.role = 'owner';
  if not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_tg_senders:' || ws::text, 0));

  select l.sender_id into sid from public.app_tg_day_senders l
    where l.workspace_id = ws and l.room_key = p_room_key and l.day = p_day and l.label = p_label;
  if sid is null then
    if nm is null then
      return pg_catalog.jsonb_build_object('ok', true, 'changed', false);
    end if;
    insert into public.app_tg_senders (workspace_id, name) values (ws, nm) returning id into sid;
    insert into public.app_tg_day_senders (workspace_id, room_key, day, label, sender_id)
    values (ws, p_room_key, p_day, p_label, sid);
    return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'id', sid, 'name', nm, 'keyed', false);
  end if;
  update public.app_tg_senders s set name = nm, updated_at = pg_catalog.now()
    where s.id = sid and s.workspace_id = ws and s.name is distinct from nm;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', found, 'id', sid, 'name', nm,
    'keyed', (select s.sender_key is not null from public.app_tg_senders s where s.id = sid));
end
$$;

-- 합치기: p_from의 연결을 p_to로 옮기고 p_from을 지운다. 이름은 p_to 것이 먼저, 없으면 p_from 것. p_to에 열쇠가 없으면 p_from의 열쇠를 이어받는다(둘 다 있으면 p_to 열쇠만 남는다).
create function public.app_tg_sender_merge(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  f public.app_tg_senders%rowtype;
  t public.app_tg_senders%rowtype;
  moved integer;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  select s.workspace_id into ws from public.app_tg_senders s where s.id = p_from;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_tg_senders:' || ws::text, 0));
  select * into f from public.app_tg_senders s where s.id = p_from and s.workspace_id = ws;
  select * into t from public.app_tg_senders s where s.id = p_to and s.workspace_id = ws;
  if f.id is null or t.id is null then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  update public.app_tg_day_senders l set sender_id = p_to where l.workspace_id = ws and l.sender_id = p_from;
  get diagnostics moved = row_count;
  delete from public.app_tg_senders s where s.id = p_from and s.workspace_id = ws;
  update public.app_tg_senders s
    set sender_key = coalesce(t.sender_key, f.sender_key),
        name = coalesce(t.name, f.name),
        auto_name = coalesce(t.auto_name, f.auto_name),
        is_self = t.is_self or f.is_self,
        updated_at = pg_catalog.now()
    where s.id = p_to and s.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_to, 'moved', moved);
end
$$;

create function public.app_tg_sender_forget(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  links integer;
begin
  if p_id is null then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  select s.workspace_id into ws from public.app_tg_senders s where s.id = p_id;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_tg_senders:' || ws::text, 0));
  select pg_catalog.count(*) into links from public.app_tg_day_senders l where l.workspace_id = ws and l.sender_id = p_id;
  delete from public.app_tg_senders s where s.id = p_id and s.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'removed_links', links);
end
$$;

revoke all on function public.app_tg_senders_upsert(uuid, text, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_tg_sender_set_name(text, date, text, text) from public, anon, authenticated, service_role;
revoke all on function public.app_tg_sender_merge(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_tg_sender_forget(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_tg_senders_upsert(uuid, text, date, jsonb) to service_role;
grant execute on function public.app_tg_sender_set_name(text, date, text, text) to authenticated;
grant execute on function public.app_tg_sender_merge(uuid, uuid) to authenticated;
grant execute on function public.app_tg_sender_forget(uuid) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where oid in (to_regprocedure('public.app_tg_senders_upsert(uuid,text,date,jsonb)'), to_regprocedure('public.app_tg_sender_set_name(text,date,text,text)'),
         to_regprocedure('public.app_tg_sender_merge(uuid,uuid)'), to_regprocedure('public.app_tg_sender_forget(uuid)'))
         and prosecdef and proconfig = array['search_path=""']
         and not has_function_privilege('anon', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 4
     or not has_function_privilege('service_role', 'public.app_tg_senders_upsert(uuid,text,date,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.app_tg_senders_upsert(uuid,text,date,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_tg_sender_set_name(text,date,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_tg_sender_merge(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_tg_sender_forget(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_tg_sender_set_name(text,date,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.app_tg_sender_merge(uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_tg_sender_forget(uuid)', 'execute')
     or (select count(*) from pg_class where oid in ('public.app_tg_senders'::regclass, 'public.app_tg_day_senders'::regclass)
         and relrowsecurity and not relforcerowsecurity and coalesce(relacl::text, '') !~ '(^|[{,])(anon)?=') <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_tg_senders'::regclass, 'public.app_tg_day_senders'::regclass)
         and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_tg_senders'::regclass, 'public.app_tg_day_senders'::regclass)) <> 2
     or has_table_privilege('authenticated', 'public.app_tg_senders', 'insert')
     or has_table_privilege('authenticated', 'public.app_tg_senders', 'update')
     or has_table_privilege('authenticated', 'public.app_tg_senders', 'delete')
     or has_table_privilege('authenticated', 'public.app_tg_day_senders', 'insert')
     or has_table_privilege('authenticated', 'public.app_tg_day_senders', 'update')
     or has_table_privilege('authenticated', 'public.app_tg_day_senders', 'delete')
     or has_any_column_privilege('service_role', 'public.app_tg_senders', 'select')
     or has_any_column_privilege('service_role', 'public.app_tg_day_senders', 'select')
     or has_any_column_privilege('anon', 'public.app_tg_senders', 'select')
     or has_any_column_privilege('anon', 'public.app_tg_day_senders', 'select') then
    raise exception 'TG_SENDER_NAMES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026190000', 'tg_sender_names', array['TG-발언자이름 1단계: new tables app_tg_senders (person, hashed key only, no raw number) and app_tg_day_senders (room/day/label to person), both owner RLS select-only for authenticated, no anon/PUBLIC/service_role table privileges; four SECURITY DEFINER functions with empty search_path (upsert: service_role only; set_name, merge, forget: authenticated with owner check); no change to existing tables, policies, grants or functions']);
commit;
