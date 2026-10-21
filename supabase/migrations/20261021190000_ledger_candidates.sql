begin;
-- AI-서버연동 S7-c: 원장 후보 함수 2개. 설계: docs/design/ledger-web2.md 4·15절. 앞 단계: 20261021082000_ledger_schema(표·권한),
-- 20261021150000_ledger_import(가져오기 함수). 표·정책·트리거·기존 함수는 바꾸지 않는다. 후보는 S7-a 표 app_ledger_candidates를 쓴다.
-- 함수는 모두 SECURITY INVOKER·search_path 빈칸이라 기존 owner RLS·칸 권한·트리거(고정 ID·감사 기록·결정된 후보 잠금)가 그대로 걸린다.
-- 실행은 authenticated만(PUBLIC·anon·service_role 없음).
--   app_confirm_ledger_candidate : 대기 후보 하나를 한 거래로 원장에 넣고(새 기록·출처·연결) 후보를 "확정"으로. p_edit가 있으면
--                                  [고쳐서 확정]: 후보의 제목·민감도·내용을 먼저 고친 뒤(고치기 전 값은 감사 기록) 같은 처리를 한다.
--   app_queue_ledger_candidates  : Claude 가져오기 파일(kind = candidates)을 가져오기 묶음 하나 + 대기 후보들로 넣는다(원장 행은 만들지 않음).
-- AI(ai-assist)는 원장에 직접 쓰지 않는다. 후보를 "대기"로 넣을 뿐이고, 원장 행은 명진이 [확정]을 눌러 이 함수가 만든다.
-- 이름이 app_ledger_·app_import_ledger_로 시작하지 않는 것은 앞 단계 짝 확인 SQL(함수 6개·4개 세기)과 섞이지 않게 하려는 것이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 적용되지 않았거나, 이미 적용됐거나, 같은 이름 함수가 있으면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021082000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021150000')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261021190000')
     or to_regclass('public.app_ledger_candidates') is null
     or to_regclass('public.app_ledger_records') is null
     or to_regclass('public.app_ledger_sources') is null
     or to_regclass('public.app_ledger_record_sources') is null
     or to_regclass('public.app_ledger_links') is null
     or to_regclass('public.app_ledger_imports') is null
     or to_regclass('public.app_ledger_audit') is null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.proname in ('app_confirm_ledger_candidate', 'app_queue_ledger_candidates'))
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'app_is_workspace_owner' and p.prosecdef) then
    raise exception 'LEDGER_CANDIDATES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 확정: 후보 내용(payload) 모양
--   { record: {summary, scope, topic(주제 ID), importance, validity(current·needs_check·fulfilled), confidence, verification,
--              date_start, date_end, date_precision, date_note, event_status, decision_type, decision_reason, evidence_type,
--              counterparty, commitment_status, follow_up_on, note},
--     supersede_reason: 대체 이유(action = supersede일 때 꼭),
--     sources: [ {source: 출처 ID, locator, note} | {new: {title, doc_type, location, drive_file_id, source_date, sensitivity, note}, locator, note} ],
--     links:   [ {target_record: 기록 ID | target_organization: 조직 ID | target_project_id | target_meeting_id, relation, note} ],
--     origin_ref: {kind, id, day} (Web2 원래 기록, 화면 표시용) }
-- action: new(새 기록) / supersede(새 기록 + 대상 기록을 대체) / add_source(대상 기록에 출처·연결만 더함). update는 손으로 고친다(거절).
-- 하나라도 틀리면 거래 전체가 취소되고 후보는 그대로 대기로 남는다. Web2 기록 출처(위치가 web2:로 시작)는 같은 위치의 출처를 다시 쓴다.
create function public.app_confirm_ledger_candidate(p_candidate_id uuid, p_edit jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c public.app_ledger_candidates%rowtype;
  v_payload jsonb;
  v_rec jsonb;
  v_item jsonb;
  v_new jsonb;
  v_record uuid;
  v_ledger text;
  v_topic uuid;
  v_src uuid;
  v_t_record uuid;
  v_t_org uuid;
  v_t_project uuid;
  v_t_meeting uuid;
  v_sources integer := 0;
  v_links integer := 0;
  v_n integer;
  v_msg text;
  v_constraint text;
begin
  select * into c from public.app_ledger_candidates where id = p_candidate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'LEDGER_CANDIDATE_NOT_FOUND';
  end if;
  if c.status <> 'pending' then
    raise exception using errcode = '55000', message = 'LEDGER_CANDIDATE_DECIDED: this candidate was already confirmed or discarded';
  end if;
  if c.action = 'update' then
    raise exception using errcode = '0A000', message = 'LEDGER_CANDIDATE_UPDATE_MANUAL: change the record itself, then discard this candidate';
  end if;

  begin
    -- [고쳐서 확정]: 제목·민감도·내용만 고칠 수 있다(종류·대상·출처 종류는 못 바꿈). 고치기 전 값은 감사 기록(row_update)에 남는다.
    if p_edit is not null then
      if pg_catalog.jsonb_typeof(p_edit) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(p_edit) k where k not in ('title', 'sensitivity', 'payload'))
         or (p_edit ? 'payload' and pg_catalog.jsonb_typeof(p_edit -> 'payload') <> 'object') then
        raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_EDIT';
      end if;
      update public.app_ledger_candidates
        set title = coalesce(p_edit ->> 'title', c.title),
            sensitivity = coalesce(p_edit ->> 'sensitivity', c.sensitivity),
            payload = coalesce(p_edit -> 'payload', c.payload)
        where id = c.id and status = 'pending';
      select * into c from public.app_ledger_candidates where id = p_candidate_id;
    end if;

    v_payload := c.payload;
    v_rec := coalesce(v_payload -> 'record', '{}'::jsonb);
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_payload) k
               where k not in ('record', 'supersede_reason', 'sources', 'links', 'origin_ref'))
       or pg_catalog.jsonb_typeof(v_rec) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_rec) k where k not in (
         'summary', 'scope', 'topic', 'importance', 'validity', 'confidence', 'verification', 'date_start', 'date_end',
         'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
         'commitment_status', 'follow_up_on', 'note'))
       or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'sources', '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'links', '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_array_length(coalesce(v_payload -> 'sources', '[]'::jsonb)) > 20
       or pg_catalog.jsonb_array_length(coalesce(v_payload -> 'links', '[]'::jsonb)) > 20
       or coalesce(v_rec ->> 'validity', 'current') not in ('current', 'needs_check', 'fulfilled') then
      raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_PAYLOAD: shape';
    end if;

    if c.action in ('new', 'supersede') then
      if (v_rec ->> 'topic') is not null then
        select t.id into v_topic from public.app_ledger_topics t
        where t.workspace_id = c.workspace_id and t.ledger_id = (v_rec ->> 'topic');
        if v_topic is null then
          raise exception using errcode = '23503', message = 'LEDGER_CANDIDATE_BROKEN_REF: topic ' || (v_rec ->> 'topic');
        end if;
      end if;
      -- 고정 ID는 DB가 붙인다(번호표의 다음 번호). 종류별 기본값: 사건은 추적중, 약속은 대기.
      insert into public.app_ledger_records (workspace_id, kind, title, summary, scope, topic_id, sensitivity, importance, validity,
        confidence, verification, date_start, date_end, date_precision, date_note, event_status, decision_type, decision_reason,
        evidence_type, counterparty, commitment_status, follow_up_on, note)
      values (c.workspace_id, c.kind, c.title, coalesce(v_rec ->> 'summary', ''), coalesce(v_rec ->> 'scope', 'work'), v_topic,
        c.sensitivity, coalesce(v_rec ->> 'importance', 'normal'), coalesce(v_rec ->> 'validity', 'current'),
        v_rec ->> 'confidence', v_rec ->> 'verification', (v_rec ->> 'date_start')::date, (v_rec ->> 'date_end')::date,
        coalesce(v_rec ->> 'date_precision', case when (v_rec ->> 'date_start') is null then 'unknown' else 'day' end),
        coalesce(v_rec ->> 'date_note', ''),
        case when c.kind = 'event' then coalesce(v_rec ->> 'event_status', 'tracking') end,
        v_rec ->> 'decision_type', v_rec ->> 'decision_reason', v_rec ->> 'evidence_type', v_rec ->> 'counterparty',
        case when c.kind = 'commitment' then coalesce(v_rec ->> 'commitment_status', 'waiting') end,
        (v_rec ->> 'follow_up_on')::date, coalesce(v_rec ->> 'note', ''))
      returning id, ledger_id into v_record, v_ledger;
      if c.action = 'supersede' then
        if coalesce(pg_catalog.btrim(v_payload ->> 'supersede_reason'), '') = '' then
          raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_PAYLOAD: supersede_reason';
        end if;
        update public.app_ledger_records
          set validity = 'superseded', superseded_by = v_record, supersede_reason = v_payload ->> 'supersede_reason'
          where id = c.target_record_id and workspace_id = c.workspace_id and validity not in ('superseded', 'retired');
        get diagnostics v_n = row_count;
        if v_n <> 1 then
          raise exception using errcode = '55000', message = 'LEDGER_CANDIDATE_TARGET_INACTIVE: the record to replace is already replaced or retired';
        end if;
      end if;
    else
      select r.id, r.ledger_id into v_record, v_ledger from public.app_ledger_records r
      where r.id = c.target_record_id and r.workspace_id = c.workspace_id;
      if v_record is null then
        raise exception using errcode = '23503', message = 'LEDGER_CANDIDATE_BROKEN_REF: target record';
      end if;
    end if;

    -- 출처: 이미 원장에 있는 출처 ID 또는 새 출처(새 고정 ID). 같은 기록·출처·근거위치는 한 번만.
    for v_item in select e from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'sources', '[]'::jsonb)) e loop
      v_src := null;
      if pg_catalog.jsonb_typeof(v_item) <> 'object' or ((v_item ? 'source') = (v_item ? 'new'))
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('source', 'new', 'locator', 'note')) then
        raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_PAYLOAD: sources';
      end if;
      if v_item ? 'source' then
        select s.id into v_src from public.app_ledger_sources s
        where s.workspace_id = c.workspace_id and s.ledger_id = (v_item ->> 'source');
        if v_src is null then
          raise exception using errcode = '23503', message = 'LEDGER_CANDIDATE_BROKEN_REF: source ' || coalesce(v_item ->> 'source', '?');
        end if;
      else
        v_new := v_item -> 'new';
        if pg_catalog.jsonb_typeof(v_new) <> 'object'
           or exists (select 1 from pg_catalog.jsonb_object_keys(v_new) k where k not in (
             'title', 'doc_type', 'location', 'drive_file_id', 'source_date', 'sensitivity', 'note')) then
          raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_PAYLOAD: sources.new';
        end if;
        if coalesce(v_new ->> 'location', '') like 'web2:%' then
          select s.id into v_src from public.app_ledger_sources s
          where s.workspace_id = c.workspace_id and s.location = (v_new ->> 'location') and s.status = 'active'
          order by s.created_at limit 1;
        end if;
        if v_src is null then
          insert into public.app_ledger_sources (workspace_id, title, doc_type, location, drive_file_id, source_date, sensitivity, note)
          values (c.workspace_id, v_new ->> 'title', coalesce(v_new ->> 'doc_type', 'other'), coalesce(v_new ->> 'location', ''),
            v_new ->> 'drive_file_id', (v_new ->> 'source_date')::date, coalesce(v_new ->> 'sensitivity', c.sensitivity),
            coalesce(v_new ->> 'note', ''))
          returning id into v_src;
        end if;
      end if;
      insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator, note)
      values (c.workspace_id, v_record, v_src, coalesce(v_item ->> 'locator', ''), coalesce(v_item ->> 'note', ''))
      on conflict on constraint app_ledger_record_sources_key do nothing;
      get diagnostics v_n = row_count;
      v_sources := v_sources + v_n;
    end loop;

    -- 연결: 대상은 기록·원장 조직(ID) 또는 Web2 프로젝트·회의(같은 작업공간, 정책이 확인) 중 정확히 하나. 같은 연결은 한 번만.
    for v_item in select e from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'links', '[]'::jsonb)) e loop
      v_t_record := null; v_t_org := null; v_t_project := null; v_t_meeting := null;
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in (
           'target_record', 'target_organization', 'target_project_id', 'target_meeting_id', 'relation', 'note'))
         or pg_catalog.num_nonnulls(v_item ->> 'target_record', v_item ->> 'target_organization',
              v_item ->> 'target_project_id', v_item ->> 'target_meeting_id') <> 1 then
        raise exception using errcode = '22023', message = 'LEDGER_CANDIDATE_BAD_PAYLOAD: links';
      end if;
      if v_item ? 'target_record' then
        select r.id into v_t_record from public.app_ledger_records r
        where r.workspace_id = c.workspace_id and r.ledger_id = (v_item ->> 'target_record');
        if v_t_record is null then
          raise exception using errcode = '23503', message = 'LEDGER_CANDIDATE_BROKEN_REF: record ' || (v_item ->> 'target_record');
        end if;
      elsif v_item ? 'target_organization' then
        select o.id into v_t_org from public.app_ledger_organizations o
        where o.workspace_id = c.workspace_id and o.ledger_id = (v_item ->> 'target_organization');
        if v_t_org is null then
          raise exception using errcode = '23503', message = 'LEDGER_CANDIDATE_BROKEN_REF: organization ' || (v_item ->> 'target_organization');
        end if;
      elsif v_item ? 'target_project_id' then
        v_t_project := (v_item ->> 'target_project_id')::uuid;
      else
        v_t_meeting := (v_item ->> 'target_meeting_id')::uuid;
      end if;
      insert into public.app_ledger_links (workspace_id, record_id, target_record_id, target_organization_id, target_project_id,
        target_meeting_id, relation, note)
      values (c.workspace_id, v_record, v_t_record, v_t_org, v_t_project, v_t_meeting,
        coalesce(v_item ->> 'relation', case when v_t_org is not null then 'reference' else 'related' end), coalesce(v_item ->> 'note', ''))
      on conflict on constraint app_ledger_links_unique do nothing;
      get diagnostics v_n = row_count;
      v_links := v_links + v_n;
    end loop;

    -- 후보 확정(트리거가 감사 기록 candidate_decided를 남기고, 이후 이 후보는 못 바꾼다).
    update public.app_ledger_candidates
      set status = 'confirmed', result_record_id = v_record, decided_at = pg_catalog.now()
      where id = c.id and status = 'pending';
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or foreign_key_violation or insufficient_privilege or unique_violation then
      get stacked diagnostics v_msg = message_text, v_constraint = constraint_name;
      if v_msg like 'LEDGER\_%' then
        raise exception using errcode = sqlstate, message = v_msg;
      end if;
      raise exception using errcode = sqlstate,
        message = 'LEDGER_CANDIDATE_BAD_RECORD: ' || coalesce(nullif(v_constraint, ''), sqlstate);
  end;
  return pg_catalog.jsonb_build_object('candidate_id', c.id, 'status', 'confirmed', 'action', c.action, 'record_id', v_record,
    'ledger_id', v_ledger, 'sources_added', v_sources, 'links_added', v_links);
end;
$$;

-- 후보 묶음 넣기(Claude 가져오기 파일, kind = candidates): 묶음 1행(파일 지문, 같은 파일은 다시 못 넣음) + 대기 후보들.
-- 후보 하나: {action, kind, title, sensitivity(S0~S2), target(대상 기록 ID, new가 아니면 꼭), dedup_key, payload(위 모양)}.
-- 원장 행은 만들지 않으므로 묶음은 넣자마자 "확인"으로 잠근다(되돌리기 대신 화면에서 후보를 버림). 같은 중복 열쇠의 대기 후보는 건너뛴다.
-- p_dry_run이면 넣어 본 뒤 모두 되돌리고 개수만 돌려준다.
create function public.app_queue_ledger_candidates(p_workspace_id uuid, p_file jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import uuid;
  v_list jsonb;
  v_total integer;
  v_added integer;
  v_missing text;
  v_result jsonb;
begin
  if p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_QUEUE_NOT_OWNER';
  end if;
  if p_dry_run is null or p_file is null or pg_catalog.jsonb_typeof(p_file) <> 'object'
     or (p_file ->> 'format') is distinct from 'kptu-ledger-import' or (p_file ->> 'version') is distinct from '1'
     or (p_file ->> 'kind') is distinct from 'candidates' or coalesce(p_file ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'LEDGER_QUEUE_BAD_FILE: format';
  end if;
  v_list := p_file -> 'candidates';
  if pg_catalog.jsonb_typeof(v_list) is distinct from 'array' or pg_catalog.jsonb_array_length(v_list) not between 1 and 500
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_list) e
       where pg_catalog.jsonb_typeof(e) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(e) k
           where k not in ('action', 'kind', 'title', 'sensitivity', 'target', 'dedup_key', 'payload'))
         or pg_catalog.jsonb_typeof(coalesce(e -> 'payload', '{}'::jsonb)) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(coalesce(e -> 'payload', '{}'::jsonb)) k
           where k not in ('record', 'supersede_reason', 'sources', 'links', 'origin_ref'))) then
    raise exception using errcode = '22023', message = 'LEDGER_QUEUE_BAD_FILE: candidates';
  end if;
  v_total := pg_catalog.jsonb_array_length(v_list);
  if exists (select 1 from public.app_ledger_imports i
             where i.workspace_id = p_workspace_id and i.file_sha256 = (p_file ->> 'sha256') and i.status in ('applied', 'confirmed')) then
    raise exception using errcode = '23505', message = 'LEDGER_IMPORT_DUPLICATE_FILE: this file was already imported';
  end if;
  -- 대상 기록: new가 아니면 꼭 있어야 하고, 이미 원장에 있는 ID여야 한다. 없으면 묶음 전체 거절(앞 20개).
  select pg_catalog.string_agg(m.ref, ', ') into v_missing
  from (select coalesce(e ->> 'title', '?') || ' → ' || coalesce(e ->> 'target', '(없음)') as ref
        from pg_catalog.jsonb_array_elements(v_list) e
        left join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = (e ->> 'target')
        where (coalesce(e ->> 'action', 'new') <> 'new') <> ((e ->> 'target') is not null) or ((e ->> 'target') is not null and r.id is null)
        limit 20) m;
  if v_missing is not null then
    raise exception using errcode = '23503', message = 'LEDGER_QUEUE_BROKEN_REF: ' || v_missing;
  end if;

  begin
    insert into public.app_ledger_imports (workspace_id, label, source_kind, file_sha256, row_counts)
    values (p_workspace_id, coalesce(p_file ->> 'label', ''), 'claude_file', p_file ->> 'sha256',
      pg_catalog.jsonb_build_object('candidates', v_total, 'report', coalesce(p_file -> 'report', '{}'::jsonb)))
    returning id into v_import;
    insert into public.app_ledger_candidates (workspace_id, origin, action, kind, target_record_id, title, payload, sensitivity, dedup_key, import_id)
    select p_workspace_id, 'claude_import', coalesce(e ->> 'action', 'new'), e ->> 'kind', r.id, e ->> 'title',
      coalesce(e -> 'payload', '{}'::jsonb), coalesce(e ->> 'sensitivity', 'S1'), nullif(e ->> 'dedup_key', ''), v_import
    from pg_catalog.jsonb_array_elements(v_list) e
    left join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = (e ->> 'target')
    on conflict (workspace_id, dedup_key) where status = 'pending' and dedup_key is not null do nothing;
    get diagnostics v_added = row_count;
    update public.app_ledger_imports set status = 'confirmed', decided_at = pg_catalog.now()
      where id = v_import and status = 'applied';
    insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, import_id, detail)
    values (p_workspace_id, 'import_applied', 'imports', v_import, v_import,
      pg_catalog.jsonb_build_object('candidates', v_total, 'added', v_added));
    insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, import_id, detail)
    values (p_workspace_id, 'import_confirmed', 'imports', v_import, v_import, '{}'::jsonb);
    v_result := pg_catalog.jsonb_build_object('import_id', v_import, 'status', 'confirmed', 'dry_run', p_dry_run,
      'candidates', v_total, 'added', v_added, 'skipped', v_total - v_added);
    if p_dry_run then
      raise exception using errcode = 'LDRY1', message = 'LEDGER_QUEUE_DRY_RUN';
    end if;
  exception
    when sqlstate 'LDRY1' then
      return v_result || pg_catalog.jsonb_build_object('import_id', null, 'status', 'dry_run');
    when check_violation or not_null_violation then
      raise exception using errcode = '23514', message = 'LEDGER_QUEUE_BAD_CANDIDATE: ' || sqlerrm;
    when unique_violation then
      raise exception using errcode = '23505', message = 'LEDGER_IMPORT_DUPLICATE_FILE: this file was already imported';
  end;
  return v_result;
end;
$$;

revoke all on function public.app_confirm_ledger_candidate(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_queue_ledger_candidates(uuid, jsonb, boolean) from public, anon, service_role;
grant execute on function public.app_confirm_ledger_candidate(uuid, jsonb) to authenticated;
grant execute on function public.app_queue_ledger_candidates(uuid, jsonb, boolean) to authenticated;

-- 사후 확인: 함수 2개 모두 INVOKER·search_path 빈칸, anon·PUBLIC·service_role 실행 권한 없음.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('app_confirm_ledger_candidate', 'app_queue_ledger_candidates')
          and not p.prosecdef and p.proconfig = array['search_path=""']
          and p.proacl is not null and p.proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 2 then
    raise exception 'LEDGER_CANDIDATES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021190000', 'ledger_candidates', array['S7-c: app_confirm_ledger_candidate (one transaction: candidate -> ledger record, sources, links; confirmed), app_queue_ledger_candidates (Claude candidates file -> pending candidates); both SECURITY INVOKER, authenticated only']);
commit;
