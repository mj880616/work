begin;
-- 20261025110000_ledger_sources의 짝 되돌리기(SQL Editor 경로 전용: 함수 본문 복원·표 삭제는 workflow rollback 허용 목록 밖).
-- 새 종류(call·weekly_personal·calendar_ref)의 처리 표 행·원장 출처, 참고 일정 행, 프로필 고르기 값(ledger_calendar)이 하나라도 있으면 멈춘다. 그때는 순서:
--   1) 원장 화면에서 그 원문에서 나온 기록을 틀림으로 표시하고(이 파일은 기록을 지우지 않는다) 필요하면 내보낸다.
--   2) 명진 확인 뒤, 처리 표 행·출처·참고 일정 행의 삭제를 따로 승인받아 실행한다.
--   3) 그 다음에 이 파일을 실행한다.
-- 순서: 함수 두 개를 앞 단계(20261024120000) 본문 그대로 복원 → 도우미 삭제 → 참고 일정 표·검사 함수 삭제 → 프로필 칸 삭제 → 처리 표 CHECK를 옛 여섯 종류로 → 기록 1행 삭제.
-- 기존 원장 기록·근거·수정 요청·프로필의 다른 값에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261025110000' and name = 'ledger_sources') <> 1 then
    raise exception 'LEDGER_SOURCES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_ledger_auto_sources where source_kind in ('call', 'weekly_personal', 'calendar_ref'))
     or exists (select 1 from public.app_ledger_sources where location ~ '^web2:(call|weekly_personal|calendar_ref):')
     or exists (select 1 from public.app_calendar_work_refs)
     or exists (select 1 from public.app_profiles where ledger_calendar <> '{}'::jsonb) then
    raise exception 'LEDGER_SOURCES_ROLLBACK_BLOCKED: new-kind rows exist; mark the records wrong, export, and delete these rows first with separate approval';
  end if;
end
$$;

-- 앞 단계(20261024120000) 본문 그대로.
create or replace function private.app_auto_ledger_source(p_workspace_id uuid, p_spec jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_src uuid;
  v_loc text;
begin
  if p_spec is null or pg_catalog.jsonb_typeof(p_spec) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_spec) k
       where k not in ('ledger_id', 'kind', 'id', 'title', 'doc_type', 'source_date', 'sensitivity', 'note')) then
    raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: source';
  end if;
  if p_spec ? 'ledger_id' then
    if p_spec <> pg_catalog.jsonb_build_object('ledger_id', p_spec -> 'ledger_id') then
      raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: source';
    end if;
    select s.id into v_src from public.app_ledger_sources s
      where s.workspace_id = p_workspace_id and s.ledger_id = (p_spec ->> 'ledger_id') and s.status = 'active';
    if v_src is null then
      raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: source ' || coalesce(p_spec ->> 'ledger_id', '?');
    end if;
    return v_src;
  end if;
  if (p_spec ->> 'kind') is null or (p_spec ->> 'kind') not in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update')
     or (p_spec ->> 'id') is null or (p_spec ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(pg_catalog.btrim(p_spec ->> 'title'), '') = '' then
    raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: source';
  end if;
  if private.app_auto_ledger_personal(pg_catalog.concat_ws(' ', p_spec ->> 'title', p_spec ->> 'note')) then
    raise exception using errcode = '22023', message = 'LEDGER_AUTO_PERSONAL: source';
  end if;
  v_loc := 'web2:' || (p_spec ->> 'kind') || ':' || pg_catalog.lower(p_spec ->> 'id');
  select s.id into v_src from public.app_ledger_sources s
    where s.workspace_id = p_workspace_id and s.location = v_loc and s.status = 'active'
    order by s.created_at limit 1;
  if v_src is null then
    insert into public.app_ledger_sources (workspace_id, title, doc_type, location, source_date, sensitivity, note)
    values (p_workspace_id, p_spec ->> 'title', coalesce(p_spec ->> 'doc_type', 'other'), v_loc,
      (p_spec ->> 'source_date')::date, coalesce(p_spec ->> 'sensitivity', 'S1'), coalesce(p_spec ->> 'note', ''))
    returning id into v_src;
  end if;
  return v_src;
end
$$;
create or replace function public.app_auto_ledger_record(p_run_id uuid, p_batch jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  r public.app_ledger_auto_runs%rowtype;
  v_item jsonb;
  v_idx integer;
  v_src jsonb;
  v_op text;
  v_kind text;
  v_keys text[] := '{}';
  v_by_item uuid[] := '{}';
  v_kinds text[] := '{}';
  v_rec jsonb;
  v_rid uuid;
  v_target uuid;
  v_target_kind text;
  v_source uuid;
  v_line uuid;
  v_link jsonb;
  v_t_org uuid;
  v_t_project uuid;
  v_t_meeting uuid;
  v_dedup text;
  v_n integer;
  v_today text := pg_catalog.to_char((pg_catalog.now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  v_new integer := 0;
  v_changes integer := 0;
  v_added integer := 0;
  v_flag integer := 0;
  v_skip integer := 0;
  v_seen integer := 0;
  v_excluded integer;
  v_tin integer;
  v_tout integer;
  v_msg text;
  v_state text;
  v_constraint text;
  v_code text;
begin
  select * into r from public.app_ledger_auto_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEDGER_AUTO_RUN_NOT_FOUND';
  end if;
  if not private.app_is_workspace_owner(r.workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_AUTO_NOT_OWNER';
  end if;
  if r.status <> 'running' then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_RUN_NOT_RUNNING';
  end if;

  begin
    if p_batch is null or pg_catalog.jsonb_typeof(p_batch) <> 'object' or octet_length(p_batch::text) > 400000
       or exists (select 1 from pg_catalog.jsonb_object_keys(p_batch) k
         where k not in ('sources', 'items', 'needs_check', 'excluded', 'tokens_in', 'tokens_out'))
       or pg_catalog.jsonb_typeof(coalesce(p_batch -> 'sources', '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_typeof(coalesce(p_batch -> 'items', '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_typeof(coalesce(p_batch -> 'needs_check', '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_array_length(coalesce(p_batch -> 'sources', '[]'::jsonb)) > 200
       or pg_catalog.jsonb_array_length(coalesce(p_batch -> 'items', '[]'::jsonb)) > 100
       or pg_catalog.jsonb_array_length(coalesce(p_batch -> 'needs_check', '[]'::jsonb)) > 50 then
      raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_BATCH: shape';
    end if;
    v_excluded := coalesce((p_batch ->> 'excluded')::integer, 0);
    v_tin := coalesce((p_batch ->> 'tokens_in')::integer, 0);
    v_tout := coalesce((p_batch ->> 'tokens_out')::integer, 0);

    -- 본 원문 목록(같은 원문이 두 번 있으면 거절).
    for v_src in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'sources', '[]'::jsonb)) e loop
      if pg_catalog.jsonb_typeof(v_src) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_src) k where k not in ('kind', 'id', 'updated_at'))
         or (v_src ->> 'kind') is null or (v_src ->> 'kind') not in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update')
         or (v_src ->> 'id') is null or (v_src ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (v_src ->> 'updated_at') is null
         or (v_src ->> 'kind') || ':' || pg_catalog.lower(v_src ->> 'id') = any (v_keys) then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_BATCH: sources';
      end if;
      v_keys := v_keys || ((v_src ->> 'kind') || ':' || pg_catalog.lower(v_src ->> 'id'));
      perform (v_src ->> 'updated_at')::timestamptz;
    end loop;

    -- 항목: 새 기록 / 근거 추가.
    for v_item, v_idx in select e, o::integer from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'items', '[]'::jsonb))
      with ordinality as t(e, o) order by o loop
      v_by_item[v_idx] := null;
      v_kinds[v_idx] := null;
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: shape';
      end if;
      v_op := v_item ->> 'op';
      v_src := v_item -> 'source';
      if v_op not in ('new', 'add_source') or v_src is null or pg_catalog.jsonb_typeof(v_src) <> 'object'
         or ((v_src ? 'ledger_id') is false and ((v_src ->> 'kind') || ':' || pg_catalog.lower(coalesce(v_src ->> 'id', ''))) <> all (v_keys)) then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: source not in this batch';
      end if;

      if v_op = 'add_source' then
        if exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('op', 'target', 'source', 'locator')) then
          raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: add_source keys';
        end if;
        select x.id into v_target from public.app_ledger_records x
          where x.workspace_id = r.workspace_id and x.ledger_id = (v_item ->> 'target') and x.validity in ('current', 'needs_check', 'fulfilled');
        if v_target is null then
          raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: target ' || coalesce(v_item ->> 'target', '?');
        end if;
        v_source := private.app_auto_ledger_source(r.workspace_id, v_src);
        insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator)
        values (r.workspace_id, v_target, v_source, coalesce(v_item ->> 'locator', ''))
        on conflict on constraint app_ledger_record_sources_key do nothing
        returning id into v_line;
        if v_line is not null then
          perform private.app_auto_ledger_log(r.workspace_id, v_target, 'source_added', 'auto', r.id, null, 'record_sources', v_line, '', '{}'::jsonb, null);
          v_added := v_added + 1;
        else
          v_skip := v_skip + 1;
        end if;
        v_line := null;
        continue;
      end if;

      -- 새 기록
      if exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in (
           'op', 'kind', 'title', 'sensitivity', 'dedup_key', 'record', 'source', 'locator', 'belongs_to', 'belongs_to_item', 'links')) then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: new keys';
      end if;
      v_kind := v_item ->> 'kind';
      v_dedup := v_item ->> 'dedup_key';
      v_rec := coalesce(v_item -> 'record', '{}'::jsonb);
      if v_kind is null or v_kind not in ('event', 'change', 'decision', 'commitment')
         or v_dedup is null or pg_catalog.char_length(v_dedup) not between 1 and 300 or v_dedup ~ '[[:cntrl:]]'
         or ((v_item ? 'belongs_to') and (v_item ? 'belongs_to_item'))
         or ((v_item ? 'belongs_to' or v_item ? 'belongs_to_item') and v_kind <> 'change')
         or (v_kind = 'change' and not (v_item ? 'belongs_to' or v_item ? 'belongs_to_item'))
         or pg_catalog.jsonb_typeof(coalesce(v_item -> 'links', '[]'::jsonb)) <> 'array'
         or pg_catalog.jsonb_array_length(coalesce(v_item -> 'links', '[]'::jsonb)) > 10 then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: new';
      end if;
      -- 중복 1겹: 같은 열쇠의 자동 기록이 이미 있으면 건너뜀(DB 유일 색인이 한 번 더 막는다).
      if exists (select 1 from public.app_ledger_record_changes c where c.workspace_id = r.workspace_id and c.dedup_key = v_dedup) then
        v_skip := v_skip + 1;
        continue;
      end if;
      -- 이어 붙일 사건(변화기록): 이미 있는 현재유효 사건 또는 이 묶음 앞 항목의 사건.
      v_target := null;
      if v_item ? 'belongs_to' then
        select x.id into v_target from public.app_ledger_records x
          where x.workspace_id = r.workspace_id and x.ledger_id = (v_item ->> 'belongs_to') and x.kind = 'event'
            and x.validity in ('current', 'needs_check');
      elsif v_item ? 'belongs_to_item' then
        v_n := (v_item ->> 'belongs_to_item')::integer;
        if v_n >= 1 and v_n < v_idx and v_kinds[v_n] = 'event' then
          v_target := v_by_item[v_n];
        end if;
      end if;
      if v_kind = 'change' and v_target is null then
        raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: belongs_to';
      end if;

      v_rec := private.app_auto_ledger_insert(r.workspace_id, v_kind, v_item ->> 'title', coalesce(v_item ->> 'sensitivity', 'S1'), v_rec);
      v_rid := (v_rec ->> 'id')::uuid;
      v_by_item[v_idx] := v_rid;
      v_kinds[v_idx] := v_kind;
      v_source := private.app_auto_ledger_source(r.workspace_id, v_src);
      insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator)
      values (r.workspace_id, v_rid, v_source, coalesce(v_item ->> 'locator', ''));
      if v_target is not null then
        insert into public.app_ledger_links (workspace_id, record_id, target_record_id, relation)
        values (r.workspace_id, v_rid, v_target, 'belongs_to');
        v_changes := v_changes + 1;
      end if;
      for v_link in select e from pg_catalog.jsonb_array_elements(coalesce(v_item -> 'links', '[]'::jsonb)) e loop
        v_t_org := null; v_t_project := null; v_t_meeting := null;
        if pg_catalog.jsonb_typeof(v_link) <> 'object'
           or exists (select 1 from pg_catalog.jsonb_object_keys(v_link) k where k not in (
             'target_organization', 'target_project_id', 'target_meeting_id', 'relation', 'note'))
           or pg_catalog.num_nonnulls(v_link ->> 'target_organization', v_link ->> 'target_project_id', v_link ->> 'target_meeting_id') <> 1 then
          raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: links';
        end if;
        if v_link ? 'target_organization' then
          select o.id into v_t_org from public.app_ledger_organizations o
            where o.workspace_id = r.workspace_id and o.ledger_id = (v_link ->> 'target_organization');
          if v_t_org is null then
            raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: organization ' || (v_link ->> 'target_organization');
          end if;
        elsif v_link ? 'target_project_id' then
          v_t_project := (v_link ->> 'target_project_id')::uuid;
        else
          v_t_meeting := (v_link ->> 'target_meeting_id')::uuid;
        end if;
        insert into public.app_ledger_links (workspace_id, record_id, target_organization_id, target_project_id, target_meeting_id, relation, note)
        values (r.workspace_id, v_rid, v_t_org, v_t_project, v_t_meeting,
          coalesce(v_link ->> 'relation', case when v_t_org is not null then 'reference' else 'related' end), coalesce(v_link ->> 'note', ''))
        on conflict on constraint app_ledger_links_unique do nothing;
      end loop;
      perform private.app_auto_ledger_log(r.workspace_id, v_rid, 'created', 'auto', r.id, null, null, null, '', '{}'::jsonb, v_dedup);
      v_new := v_new + 1;
      if coalesce(v_item -> 'record' ->> 'validity', 'current') = 'needs_check' then
        v_flag := v_flag + 1;
      end if;
    end loop;

    -- 원문이 바뀌어 이미 뽑은 내용이 틀려진 기록: 현재유효만 '확인필요'로 바꾼다. 자동 기록이 기존 기록에 하는 유일한 변경이다.
    for v_item in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'needs_check', '[]'::jsonb)) e loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('record')) or (v_item ->> 'record') is null then
        raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: needs_check';
      end if;
      v_rid := null;
      update public.app_ledger_records set validity = 'needs_check'
        where workspace_id = r.workspace_id and ledger_id = (v_item ->> 'record') and validity = 'current'
        returning id into v_rid;
      if v_rid is null then
        v_skip := v_skip + 1;
      else
        perform private.app_auto_ledger_log(r.workspace_id, v_rid, 'needs_check', 'auto', r.id, null, null, null,
          '원문이 바뀌어 확인필요 · ' || v_today, pg_catalog.jsonb_build_object('prev_validity', 'current'), null);
        v_flag := v_flag + 1;
      end if;
    end loop;

    -- 원문별 처리 표(본 원문 전부): 새로 보거나 다시 본 때의 updated_at과 이 실행을 적는다.
    for v_src in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'sources', '[]'::jsonb)) e loop
      insert into public.app_ledger_auto_sources (workspace_id, source_kind, source_id, seen_updated_at, last_run_id)
      values (r.workspace_id, v_src ->> 'kind', (v_src ->> 'id')::uuid, (v_src ->> 'updated_at')::timestamptz, r.id)
      on conflict (workspace_id, source_kind, source_id)
      do update set seen_updated_at = excluded.seen_updated_at, last_run_id = excluded.last_run_id, seen_at = pg_catalog.now()
      where public.app_ledger_auto_sources.workspace_id = excluded.workspace_id;
      v_seen := v_seen + 1;
    end loop;

    update public.app_ledger_auto_runs
      set status = 'done', finished_at = pg_catalog.now(), sources_seen = v_seen, records_new = v_new, changes_linked = v_changes,
          sources_added = v_added, needs_check = v_flag, skipped = v_skip, excluded = v_excluded, tokens_in = v_tin, tokens_out = v_tout
      where id = r.id and status = 'running';
    return pg_catalog.jsonb_build_object('ok', true, 'run_id', r.id, 'sources_seen', v_seen, 'records_new', v_new,
      'changes_linked', v_changes, 'sources_added', v_added, 'needs_check', v_flag, 'skipped', v_skip, 'excluded', v_excluded);
  exception
    when others then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate, v_constraint = constraint_name;
      v_code := coalesce(pg_catalog."substring"(v_msg, '^(LEDGER_[A-Z0-9_]+)'),
        case when v_state like '22%' or v_state like '23%' then 'LEDGER_AUTO_BAD_RECORD' else 'LEDGER_AUTO_ERROR' end);
      update public.app_ledger_auto_runs
        set status = 'failed', finished_at = pg_catalog.now(), fail_code = v_code,
            tokens_in = case when p_batch ->> 'tokens_in' ~ '^[0-9]{1,9}$' then least((p_batch ->> 'tokens_in')::bigint, 100000000)::integer else 0 end,
            tokens_out = case when p_batch ->> 'tokens_out' ~ '^[0-9]{1,9}$' then least((p_batch ->> 'tokens_out')::bigint, 100000000)::integer else 0 end
        where id = p_run_id and status = 'running';
      return pg_catalog.jsonb_build_object('ok', false, 'run_id', p_run_id, 'error', v_code, 'constraint', nullif(v_constraint, ''));
  end;
end
$$;
revoke all on function private.app_auto_ledger_source(uuid,jsonb) from public, anon, service_role;
revoke all on function public.app_auto_ledger_record(uuid,jsonb) from public, anon, service_role;
grant execute on function private.app_auto_ledger_source(uuid,jsonb) to authenticated;
grant execute on function public.app_auto_ledger_record(uuid,jsonb) to authenticated;

drop function private.app_auto_ledger_source_kind_ok(text);
drop table public.app_calendar_work_refs;
drop function private.app_calendar_work_ref_guard();
alter table public.app_profiles drop constraint app_profiles_ledger_calendar_check;
alter table public.app_profiles drop column ledger_calendar;
alter table public.app_ledger_auto_sources drop constraint app_ledger_auto_sources_kind_check,
  add constraint app_ledger_auto_sources_kind_check check (source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update'));

delete from supabase_migrations.schema_migrations where version = '20261025110000' and name = 'ledger_sources';
commit;
