begin;
-- TG-요약고치기 1단계 DB (명진 10/27 16:35: 텔레그램 소식의 '그날 요약'과 시각별 요약 줄을 손으로 고치기).
-- 설계 방식은 CALL-손고치기(20261026120000_call_user_edit)와 같다: AI가 쓴 값 칸은 한 글자도 바꾸지 않고, 사용자가 고친 값은 따로 새 표에 둔다.
--   그래서 AI가 같은 날·같은 소식을 다시 요약하거나 밀린 날을 다시 채워도(app_feed_room_day_add는 더하기뿐, 소식은 넣기뿐) 사용자 값은 덮이지 않는다.
--   화면은 사용자 값이 있으면 그 값을 쓰고, [AI 원래 요약으로]는 사용자 값을 지워 AI 값이 다시 보이게 한다(AI 값은 지운 적이 없다).
-- 새 표 둘(둘 다 소유자 전용 RLS, anon·PUBLIC·service_role 권한 없음, 로그인한 본인은 읽기만. 쓰기는 아래 함수 하나로만):
--   public.app_feed_summary_edits          고친 대상 한 곳당 한 줄. target = 'item:<소식 ID>' | 'day:<방 번호>|<날짜>'. vals(jsonb): 소식은 summary, 그날 요약은 headline·lines.
--   public.app_feed_summary_edit_history   고칠 때마다 칸별 이전 값·새 값 한 줄씩 더하기만 한다(AI 원래 값이 첫 줄에 남는다). 고치기·지우기 권한 없음.
-- 새 함수 public.app_feed_summary_edit(p_item uuid, p_room_key text, p_day date, p_patch jsonb): SECURITY DEFINER, 빈 search_path, authenticated만 실행, 안에서 소유자 확인.
--   대상은 둘 중 하나: p_item(텔레그램 소식 한 줄) 또는 p_room_key+p_day(그 방·날의 그날 요약). 둘을 섞으면 거절.
--   p_patch 키: 소식 summary(1~400자, 제어문자 금지) / 그날 요약 headline(60자 이하, 빈 글 가능)·lines(글 12개 이하, 줄마다 1~150자), reset(배열: 되돌릴 칸 이름들 = 사용자 값을 지워 AI 값으로).
--   그 밖의 키는 거절. 칸마다 이전 값이 같으면 이력에 쓰지 않는다. 이력의 이전 값은 사용자 값이 없으면 그 시점의 AI 값이다(그날 요약의 AI 값은 묶음을 first_at 순으로 이어 붙인 것, 화면 mergeParts와 같은 규칙).
-- 안 하는 것: 소식 표(app_feed_items)·방·날 표(app_feed_room_days)의 칸·권한·정책·트리거·줄 변경, 기존 함수 교체(app_feed_room_day_lines 등), anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 앞 단계: 20261027010000(tg_room_day_group)이 먼저 적용돼 있어야 한다(방·날 표와 소유자 도우미 private.app_feed_owner_workspace).
-- 짝: docs/20261027200000_tg_summary_edit.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027200000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027010000' and name = 'tg_room_day_group') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_feed_room_days') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_feed_summary_edits') is not null
     or to_regclass('public.app_feed_summary_edit_history') is not null
     or to_regprocedure('public.app_feed_summary_edit(uuid,text,date,jsonb)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_feed_owner_workspace()') and prosecdef) then
    raise exception 'TG_SUMMARY_EDIT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_summary_edits (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  target text not null,
  vals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_feed_summary_edits_pkey primary key (workspace_id, target),
  constraint app_feed_summary_edits_target_check check (
    target ~ '^item:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or target ~ '^day:[A-Za-z0-9_.:-]{1,100}[|][0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint app_feed_summary_edits_vals_check check (
    jsonb_typeof(vals) = 'object'
    and ((left(target, 5) = 'item:' and not jsonb_path_exists(vals, '$.keyvalue() ? (@.key != "summary")'))
      or (left(target, 4) = 'day:' and not jsonb_path_exists(vals, '$.keyvalue() ? (@.key != "headline" && @.key != "lines")'))))
);

create table public.app_feed_summary_edit_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  target text not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  edited_at timestamptz not null default now(),
  constraint app_feed_summary_edit_history_field_check check (field in ('summary', 'headline', 'lines'))
);
create index app_feed_summary_edit_history_target_idx on public.app_feed_summary_edit_history(workspace_id, target, edited_at desc);

alter table public.app_feed_summary_edits enable row level security;
alter table public.app_feed_summary_edit_history enable row level security;
revoke all on table public.app_feed_summary_edits from public, anon, authenticated, service_role;
revoke all on table public.app_feed_summary_edit_history from public, anon, authenticated, service_role;
grant select on table public.app_feed_summary_edits to authenticated;
grant select on table public.app_feed_summary_edit_history to authenticated;
create policy feed_summary_edits_owner_read on public.app_feed_summary_edits for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy feed_summary_edit_history_owner_read on public.app_feed_summary_edit_history for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

create function public.app_feed_summary_edit(p_item uuid, p_room_key text, p_day date, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  tgt text;
  is_item boolean;
  fields text[];
  base jsonb;
  parts jsonb;
  cur jsonb;
  nxt jsonb;
  k text;
  v jsonb;
  f text;
  t text;
  elem text;
  oldv jsonb;
  newv jsonb;
  cleaned jsonb;
begin
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'TGSE_PATCH';
  end if;
  is_item := p_item is not null;
  if is_item then
    if p_room_key is not null or p_day is not null then raise exception using errcode = '22023', message = 'TGSE_ARGS'; end if;
  elsif p_room_key is null or p_day is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGSE_ARGS';
  end if;

  if is_item then
    select i.workspace_id, pg_catalog.jsonb_build_object('summary', coalesce(i.summary, ''))
      into ws, base from public.app_feed_items i where i.id = p_item and i.source = 'telegram';
    if not found or not private.app_is_workspace_owner(ws) then
      raise exception using errcode = 'P0002', message = 'TGSE_NOT_FOUND';
    end if;
    tgt := 'item:' || p_item::text;
    fields := array['summary'];
  else
    ws := private.app_feed_owner_workspace();
    if not exists (select 1 from public.app_feed_items i where i.workspace_id = ws and i.source = 'telegram' and i.room_key = p_room_key and i.day = p_day) then
      raise exception using errcode = 'P0002', message = 'TGSE_NOT_FOUND';
    end if;
    select d.parts into parts from public.app_feed_room_days d where d.workspace_id = ws and d.room_key = p_room_key and d.day = p_day;
    parts := coalesce(parts, '[]'::jsonb);
    base := pg_catalog.jsonb_build_object(
      'headline', coalesce((select s.h from (select nullif(q.p ->> 'headline', '') as h from pg_catalog.jsonb_array_elements(parts) as q(p) order by q.p ->> 'first_at') s where s.h is not null limit 1), ''),
      'lines', coalesce((select pg_catalog.jsonb_agg(x.l order by x.fa, x.pi, x.li)
                           from (select q.p ->> 'first_at' as fa, q.pi, u.l, u.li
                                   from pg_catalog.jsonb_array_elements(parts) with ordinality as q(p, pi)
                                   cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(q.p -> 'lines') = 'array' then q.p -> 'lines' else '[]'::jsonb end) with ordinality as u(l, li)) x), '[]'::jsonb));
    tgt := 'day:' || p_room_key || '|' || p_day::text;
    fields := array['headline', 'lines'];
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_summary_edit:' || ws::text || ':' || tgt, 0));

  select e.vals into cur from public.app_feed_summary_edits e where e.workspace_id = ws and e.target = tgt;
  cur := coalesce(cur, '{}'::jsonb);
  nxt := cur;

  for k, v in select * from pg_catalog.jsonb_each(p_patch) loop
    if k = 'reset' then
      if pg_catalog.jsonb_typeof(v) <> 'array' then raise exception using errcode = '22023', message = 'TGSE_RESET'; end if;
      if exists (select 1 from pg_catalog.jsonb_array_elements(v) as r(x) where pg_catalog.jsonb_typeof(r.x) <> 'string') then
        raise exception using errcode = '22023', message = 'TGSE_RESET';
      end if;
      for f in select pg_catalog.jsonb_array_elements_text(v) loop
        if not (f = any (fields)) then raise exception using errcode = '22023', message = 'TGSE_FIELD'; end if;
        nxt := nxt - f;
      end loop;
    elsif k = 'summary' and is_item then
      if pg_catalog.jsonb_typeof(v) <> 'string' then raise exception using errcode = '22023', message = 'TGSE_SUMMARY'; end if;
      t := pg_catalog.btrim(v #>> '{}');
      if pg_catalog.char_length(t) not between 1 and 400 or t ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TGSE_SUMMARY'; end if;
      nxt := pg_catalog.jsonb_set(nxt, '{summary}', pg_catalog.to_jsonb(t));
    elsif k = 'headline' and not is_item then
      if pg_catalog.jsonb_typeof(v) <> 'string' then raise exception using errcode = '22023', message = 'TGSE_HEADLINE'; end if;
      t := pg_catalog.btrim(v #>> '{}');
      if pg_catalog.char_length(t) > 60 or t ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TGSE_HEADLINE'; end if;
      nxt := pg_catalog.jsonb_set(nxt, '{headline}', pg_catalog.to_jsonb(t));
    elsif k = 'lines' and not is_item then
      if pg_catalog.jsonb_typeof(v) <> 'array' or pg_catalog.jsonb_array_length(v) not between 1 and 12
         or exists (select 1 from pg_catalog.jsonb_array_elements(v) as r(x) where pg_catalog.jsonb_typeof(r.x) <> 'string') then
        raise exception using errcode = '22023', message = 'TGSE_LINES';
      end if;
      cleaned := '[]'::jsonb;
      for elem in select pg_catalog.jsonb_array_elements_text(v) loop
        t := pg_catalog.btrim(elem);
        if pg_catalog.char_length(t) not between 1 and 150 or t ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'TGSE_LINES'; end if;
        cleaned := cleaned || pg_catalog.jsonb_build_array(t);
      end loop;
      nxt := pg_catalog.jsonb_set(nxt, '{lines}', cleaned);
    else
      raise exception using errcode = '22023', message = 'TGSE_FIELD';
    end if;
  end loop;

  if nxt = cur then
    return pg_catalog.jsonb_build_object('ok', true, 'target', tgt, 'changed', false, 'vals', cur);
  end if;

  foreach f in array fields loop
    oldv := case when pg_catalog.jsonb_exists(cur, f) then cur -> f else base -> f end;
    newv := case when pg_catalog.jsonb_exists(nxt, f) then nxt -> f else base -> f end;
    if oldv is distinct from newv then
      insert into public.app_feed_summary_edit_history (workspace_id, target, field, old_value, new_value)
      values (ws, tgt, f, oldv, newv);
    end if;
  end loop;

  insert into public.app_feed_summary_edits as x (workspace_id, target, vals)
  values (ws, tgt, nxt)
  on conflict (workspace_id, target) do update set vals = excluded.vals, updated_at = pg_catalog.now()
  where x.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'target', tgt, 'changed', true, 'vals', nxt);
end
$$;
revoke all on function public.app_feed_summary_edit(uuid, text, date, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_summary_edit(uuid, text, date, jsonb) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_feed_summary_edit(uuid,text,date,jsonb)')
         and prosecdef and proconfig = array['search_path=""']
         and has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1
     or (select count(*) from pg_class where oid in ('public.app_feed_summary_edits'::regclass, 'public.app_feed_summary_edit_history'::regclass)
         and relrowsecurity and not relforcerowsecurity and coalesce(relacl::text, '') !~ '(^|[{,])(anon)?=') <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_feed_summary_edits'::regclass, 'public.app_feed_summary_edit_history'::regclass)
         and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 2
     or (select count(*) from pg_policy where polrelid in ('public.app_feed_summary_edits'::regclass, 'public.app_feed_summary_edit_history'::regclass)) <> 2
     or has_table_privilege('authenticated', 'public.app_feed_summary_edits', 'insert')
     or has_table_privilege('authenticated', 'public.app_feed_summary_edits', 'update')
     or has_table_privilege('authenticated', 'public.app_feed_summary_edits', 'delete')
     or has_table_privilege('authenticated', 'public.app_feed_summary_edit_history', 'insert')
     or has_table_privilege('authenticated', 'public.app_feed_summary_edit_history', 'update')
     or has_table_privilege('authenticated', 'public.app_feed_summary_edit_history', 'delete')
     or has_any_column_privilege('service_role', 'public.app_feed_summary_edits', 'select')
     or has_any_column_privilege('service_role', 'public.app_feed_summary_edit_history', 'select')
     or has_any_column_privilege('anon', 'public.app_feed_summary_edits', 'select')
     or has_any_column_privilege('anon', 'public.app_feed_summary_edit_history', 'select') then
    raise exception 'TG_SUMMARY_EDIT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027200000', 'tg_summary_edit', array['TG-요약고치기 1단계: new tables app_feed_summary_edits (user values per telegram item or room-day summary, jsonb vals) and app_feed_summary_edit_history (append-only), both owner RLS select-only for authenticated, no anon/PUBLIC/service_role; app_feed_summary_edit (SECURITY DEFINER, empty search_path, owner check, execute to authenticated only); no change to existing tables, policies, grants or functions']);
commit;
