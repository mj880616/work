begin;
-- CALL-손고치기 1단계 DB (명진 10/26: 통화 제목·조직·상대 이름·핵심내용을 손으로 고치기).
-- 통화 줄(업무 app_feed_items, 개인 app_call_personal)의 AI 값 칸은 한 글자도 바꾸지 않는다. 사용자가 고친 값은 따로 새 표에 둔다.
--   그래서 AI가 나중에 같은 칸을 다시 써도(call_refill, 다시 분석) 사용자 값은 덮이지 않는다. 화면·요약 복사·원장 재료는 사용자 값이 있으면 그 값을 쓴다.
-- 새 표 둘(둘 다 소유자 전용 RLS, anon·PUBLIC 권한 없음, 로그인한 본인은 읽기만. 쓰기는 아래 함수 하나로만):
--   public.app_call_edits         통화 한 건당 한 줄. "사용자 값" 모음 vals(jsonb): 키는 title·counterpart·organization_id·points. 키가 있으면 그 칸은 사용자 값, 없으면 AI 값.
--   public.app_call_edit_history  고칠 때마다 칸별 이전 값·새 값 한 줄씩 더하기만 한다(AI 원래 값이 여기에도 남는다). 고치기·지우기 권한 없음.
--   통화 ID는 업무 통화함과 개인 통화함 사이를 옮겨도 그대로이므로 옮기기 함수(app_call_move)와 기존 표는 바꾸지 않는다.
-- 새 함수 public.app_call_edit(p_id uuid, p_patch jsonb): SECURITY DEFINER, 빈 search_path, authenticated만 실행, 안에서 소유자 확인.
--   p_patch 키: title(1~80자)·counterpart(100자 이하, 빈 글 가능)·organization_id(같은 작업공간 조직 또는 null=연결 없음)·points(글 8개 이하, 각 150자 이하), reset(배열: 되돌릴 칸 이름들 = 사용자 값을 지워 AI 값으로).
--   그 밖의 키는 거절. 개인 통화는 조직을 못 고친다(개인 표에 조직 칸이 없다). 칸마다 이전 값이 같으면 기록하지 않는다.
-- 안 하는 것: 기존 표(app_feed_items, app_call_personal)의 칸·권한·정책·트리거·CHECK 변경, 기존 함수 교체, anon·PUBLIC 권한, RLS 약화, 기존 줄 변경, rtw_* 객체.
-- 앞 단계: 20261024140000(call_tg_feed), 20261025200000(call_personal_box)가 먼저 적용돼 있어야 한다.
-- 짝: docs/20261026120000_call_user_edit.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025200000' and name = 'call_personal_box') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_call_personal') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_call_edits') is not null
     or to_regclass('public.app_call_edit_history') is not null
     or to_regprocedure('public.app_call_edit(uuid,jsonb)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'CALL_USER_EDIT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_call_edits (
  call_id uuid primary key,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  vals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_call_edits_vals_check check (
    jsonb_typeof(vals) = 'object'
    and not jsonb_path_exists(vals, '$.keyvalue() ? (@.key != "title" && @.key != "counterpart" && @.key != "organization_id" && @.key != "points")'))
);
create index app_call_edits_workspace_idx on public.app_call_edits(workspace_id);

create table public.app_call_edit_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  call_id uuid not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  edited_at timestamptz not null default now(),
  constraint app_call_edit_history_field_check check (field in ('title', 'counterpart', 'organization_id', 'points'))
);
create index app_call_edit_history_call_idx on public.app_call_edit_history(workspace_id, call_id, edited_at desc);

alter table public.app_call_edits enable row level security;
alter table public.app_call_edit_history enable row level security;
revoke all on table public.app_call_edits from public, anon, authenticated, service_role;
revoke all on table public.app_call_edit_history from public, anon, authenticated, service_role;
grant select on table public.app_call_edits to authenticated;
grant select on table public.app_call_edit_history to authenticated;
create policy call_edits_owner_read on public.app_call_edits for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy call_edit_history_owner_read on public.app_call_edit_history for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

create function public.app_call_edit(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  personal boolean := false;
  base jsonb;
  cur jsonb;
  nxt jsonb;
  k text;
  v jsonb;
  oldv jsonb;
  newv jsonb;
  f text;
  t text;
  e jsonb;
begin
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'CALL_EDIT_PATCH';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_edit:' || coalesce(p_id::text, ''), 0));

  select i.workspace_id, pg_catalog.jsonb_build_object('title', i.title, 'counterpart', i.counterpart, 'organization_id', i.organization_id, 'points', i.points)
    into ws, base from public.app_feed_items i where i.id = p_id and i.source = 'call';
  if not found then
    select c.workspace_id, pg_catalog.jsonb_build_object('title', c.title, 'counterpart', c.counterpart, 'organization_id', null, 'points', c.points)
      into ws, base from public.app_call_personal c where c.id = p_id;
    personal := found;
    if not found then
      raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
    end if;
  end if;
  if not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
  end if;

  select coalesce(x.vals, '{}'::jsonb) into cur from (select 1) s left join public.app_call_edits x on x.call_id = p_id;
  cur := coalesce(cur, '{}'::jsonb);
  nxt := cur;

  for k, v in select * from pg_catalog.jsonb_each(p_patch) loop
    if k = 'reset' then
      if pg_catalog.jsonb_typeof(v) <> 'array' then raise exception using errcode = '22023', message = 'CALL_EDIT_RESET'; end if;
      for f in select pg_catalog.jsonb_array_elements_text(v) loop
        if f not in ('title', 'counterpart', 'organization_id', 'points') then raise exception using errcode = '22023', message = 'CALL_EDIT_FIELD'; end if;
        nxt := nxt - f;
      end loop;
    elsif k = 'title' then
      if pg_catalog.jsonb_typeof(v) <> 'string' then raise exception using errcode = '22023', message = 'CALL_EDIT_TITLE'; end if;
      t := pg_catalog.btrim(v #>> '{}');
      if pg_catalog.char_length(t) not between 1 and 80 or t ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'CALL_EDIT_TITLE'; end if;
      nxt := pg_catalog.jsonb_set(nxt, '{title}', pg_catalog.to_jsonb(t));
    elsif k = 'counterpart' then
      if pg_catalog.jsonb_typeof(v) <> 'string' then raise exception using errcode = '22023', message = 'CALL_EDIT_COUNTERPART'; end if;
      t := pg_catalog.btrim(v #>> '{}');
      if pg_catalog.char_length(t) > 100 or t ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'CALL_EDIT_COUNTERPART'; end if;
      nxt := pg_catalog.jsonb_set(nxt, '{counterpart}', pg_catalog.to_jsonb(t));
    elsif k = 'organization_id' then
      if personal then raise exception using errcode = '23514', message = 'CALL_EDIT_PERSONAL_ORG'; end if;
      if pg_catalog.jsonb_typeof(v) = 'null' then
        nxt := pg_catalog.jsonb_set(nxt, '{organization_id}', 'null'::jsonb);
      elsif pg_catalog.jsonb_typeof(v) = 'string' and (v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        if not exists (select 1 from public.app_suborganizations o where o.id = (v #>> '{}')::uuid and o.workspace_id = ws) then
          raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization must be in the same workspace';
        end if;
        nxt := pg_catalog.jsonb_set(nxt, '{organization_id}', pg_catalog.to_jsonb((v #>> '{}')::uuid::text));
      else
        raise exception using errcode = '22023', message = 'CALL_EDIT_ORGANIZATION';
      end if;
    elsif k = 'points' then
      if pg_catalog.jsonb_typeof(v) <> 'array' or pg_catalog.jsonb_array_length(v) > 8
         or pg_catalog.jsonb_path_exists(v, 'strict $[*] ? (@.type() != "string")')
         or pg_catalog.jsonb_path_exists(v, '$[*] ? (!(@ like_regex "[^[:space:]]"))')
         or pg_catalog.jsonb_path_exists(v, '$[*] ? (@ like_regex "[\u0001-\u001f\u007f]")')
         or pg_catalog.jsonb_path_exists(v, '$[*] ? (@ like_regex "^.{151}.{150}")') then
        raise exception using errcode = '22023', message = 'CALL_EDIT_POINTS';
      end if;
      nxt := pg_catalog.jsonb_set(nxt, '{points}', v);
    else
      raise exception using errcode = '22023', message = 'CALL_EDIT_FIELD';
    end if;
  end loop;

  if nxt = cur then
    return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'changed', false, 'vals', cur);
  end if;

  for f in select unnest(array['title', 'counterpart', 'organization_id', 'points']) loop
    oldv := case when pg_catalog.jsonb_exists(cur, f) then cur -> f else base -> f end;
    newv := case when pg_catalog.jsonb_exists(nxt, f) then nxt -> f else base -> f end;
    if oldv is distinct from newv then
      insert into public.app_call_edit_history (workspace_id, call_id, field, old_value, new_value)
      values (ws, p_id, f, oldv, newv);
    end if;
  end loop;

  insert into public.app_call_edits as x (call_id, workspace_id, vals)
  values (p_id, ws, nxt)
  on conflict (call_id) do update set vals = excluded.vals, updated_at = pg_catalog.now()
  where x.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'changed', true, 'vals', nxt);
end
$$;
revoke all on function public.app_call_edit(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_call_edit(uuid, jsonb) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_call_edit(uuid,jsonb)')
         and prosecdef and proconfig = array['search_path=""']
         and has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1
     or (select count(*) from pg_class where oid in ('public.app_call_edits'::regclass, 'public.app_call_edit_history'::regclass)
         and relrowsecurity and not relforcerowsecurity and coalesce(relacl::text, '') !~ '(^|[{,])(anon)?=') <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_call_edits'::regclass, 'public.app_call_edit_history'::regclass)
         and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_call_edits'::regclass, 'public.app_call_edit_history'::regclass)) <> 2
     or has_table_privilege('authenticated', 'public.app_call_edits', 'insert')
     or has_table_privilege('authenticated', 'public.app_call_edits', 'update')
     or has_table_privilege('authenticated', 'public.app_call_edits', 'delete')
     or has_table_privilege('authenticated', 'public.app_call_edit_history', 'insert')
     or has_table_privilege('authenticated', 'public.app_call_edit_history', 'update')
     or has_table_privilege('authenticated', 'public.app_call_edit_history', 'delete')
     or has_any_column_privilege('service_role', 'public.app_call_edits', 'select')
     or has_any_column_privilege('service_role', 'public.app_call_edit_history', 'select')
     or has_any_column_privilege('anon', 'public.app_call_edits', 'select')
     or has_any_column_privilege('anon', 'public.app_call_edit_history', 'select') then
    raise exception 'CALL_USER_EDIT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026120000', 'call_user_edit', array['CALL-손고치기 1단계: new tables app_call_edits (user values per call, jsonb vals) and app_call_edit_history (append-only), both owner RLS select-only for authenticated, no anon/PUBLIC/service_role; app_call_edit (SECURITY DEFINER, empty search_path, owner check, execute to authenticated only); no change to existing tables, policies, grants or functions']);
commit;
