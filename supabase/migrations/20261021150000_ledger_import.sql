begin;
-- AI-서버연동 S7-b: 원장 가져오기 함수 4개. 설계: docs/design/ledger-web2.md 7절. 앞 단계: 20261021082000_ledger_schema(표·권한).
-- 표·정책·트리거·기존 함수는 바꾸지 않는다. 함수는 모두 SECURITY INVOKER·search_path 빈칸이라 기존 owner RLS·칸 권한·
-- 트리거(고정 ID·감사 기록·되돌리기 제한 정책)가 그대로 걸린다. 실행은 authenticated만(PUBLIC·anon·service_role 없음).
--   app_import_ledger_apply   : 가져오기 묶음 하나를 한 거래로 넣는다(전부 아니면 전무). p_dry_run이면 넣어 본 뒤 모두 되돌리고 개수만 돌려준다.
--   app_import_ledger_counts  : 묶음에서 실제로 들어간 행 수(숫자 확인용, 읽기만).
--   app_import_ledger_confirm : 적용(applied) → 확인(confirmed). 이후 그 묶음 행은 지울 수 없다.
--   app_import_ledger_revert  : 적용(applied) 묶음만, 고친 행이 하나도 없을 때만 그 묶음 행을 모두 지우고 되돌림(reverted).
-- 이름이 app_ledger_로 시작하지 않는 것은 20261021082000 짝 확인 SQL(원장 함수 6개 세기)과 섞이지 않게 하려는 것이다.
-- 파일 원문은 받지 않는다. 화면(app/ledger-import-model.mjs)이 브라우저 안에서 검사를 통과한 행만 보낸다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 적용되지 않았거나, 이미 적용됐거나, 같은 이름 함수가 있으면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021082000')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261021150000')
     or to_regclass('public.app_ledger_imports') is null
     or to_regclass('public.app_ledger_id_counters') is null
     or to_regclass('public.app_ledger_topics') is null
     or to_regclass('public.app_ledger_organizations') is null
     or to_regclass('public.app_ledger_sources') is null
     or to_regclass('public.app_ledger_records') is null
     or to_regclass('public.app_ledger_record_sources') is null
     or to_regclass('public.app_ledger_links') is null
     or to_regclass('public.app_ledger_audit') is null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.proname like 'app\_import\_ledger\_%')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'app_is_workspace_owner' and p.prosecdef) then
    raise exception 'LEDGER_IMPORT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 숫자 확인: 묶음에서 실제로 들어간 행 수. 소유자가 아니면(RLS) null.
create function public.app_import_ledger_counts(p_import_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'import_id', i.id,
    'label', i.label,
    'status', i.status,
    'source_kind', i.source_kind,
    'created_at', i.created_at,
    'decided_at', i.decided_at,
    'file', i.row_counts,
    'topics', (select pg_catalog.count(*) from public.app_ledger_topics t where t.import_id = i.id),
    'organizations', (select pg_catalog.count(*) from public.app_ledger_organizations o where o.import_id = i.id),
    'sources', (select pg_catalog.count(*) from public.app_ledger_sources s where s.import_id = i.id),
    'records', (select pg_catalog.count(*) from public.app_ledger_records r where r.import_id = i.id),
    'records_by_kind', coalesce((select pg_catalog.jsonb_object_agg(k.kind, k.n)
      from (select r.kind, pg_catalog.count(*) as n from public.app_ledger_records r where r.import_id = i.id group by r.kind) k),
      '{}'::jsonb),
    'record_sources', (select pg_catalog.count(*) from public.app_ledger_record_sources rs where rs.import_id = i.id),
    'links', (select pg_catalog.count(*) from public.app_ledger_links l where l.import_id = i.id),
    'links_to_records', (select pg_catalog.count(*) from public.app_ledger_links l
      where l.import_id = i.id and l.target_record_id is not null),
    'links_to_organizations', (select pg_catalog.count(*) from public.app_ledger_links l
      where l.import_id = i.id and l.target_organization_id is not null),
    'legacy_write_requests', (select pg_catalog.count(*) from public.app_ledger_audit a
      where a.import_id = i.id and a.event = 'legacy_write_request'),
    'modified', (select pg_catalog.count(*) from public.app_ledger_topics t where t.import_id = i.id and t.updated_at <> t.created_at)
      + (select pg_catalog.count(*) from public.app_ledger_organizations o where o.import_id = i.id and o.updated_at <> o.created_at)
      + (select pg_catalog.count(*) from public.app_ledger_sources s where s.import_id = i.id and s.updated_at <> s.created_at)
      + (select pg_catalog.count(*) from public.app_ledger_records r where r.import_id = i.id and r.updated_at <> r.created_at))
  from public.app_ledger_imports i
  where i.id = p_import_id
$$;

-- 가져오기: 번호표 접두어 등록 → 묶음 1행 → 주제·조직·출처 → 기록(대체 관계 순서대로) → 기록-출처·연결 → 옛 쓰기요청 → 감사 1행.
-- 하나라도 실패하면 거래 전체가 취소된다. 깨진 참조는 그 행이 아니라 묶음 전체를 거절하고 ID 목록(앞 20개)을 알려 준다.
-- p_dry_run이면 안쪽 블록을 일부러 실패시켜(LDRY1) 쓴 것을 모두 되돌리고, 되돌리기 전에 센 개수만 돌려준다.
create function public.app_import_ledger_apply(p_workspace_id uuid, p_file jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import uuid;
  v_counts jsonb;
  v_result jsonb;
  v_missing text;
  v_n integer;
  v_pass integer := 0;
  v_scope text;
  v_prefix text;
  v_existing text;
  v_registered text[] := '{}';
  v_key text;
  v_constraint text;
  v_detail text;
begin
  if p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_IMPORT_NOT_OWNER';
  end if;
  if p_dry_run is null or p_file is null or pg_catalog.jsonb_typeof(p_file) <> 'object'
     or (p_file ->> 'format') is distinct from 'kptu-ledger-import' or (p_file ->> 'version') is distinct from '1' then
    raise exception using errcode = '22023', message = 'LEDGER_IMPORT_BAD_FILE: format';
  end if;
  if (p_file ->> 'kind') = 'candidates' then
    raise exception using errcode = '22023', message = 'LEDGER_IMPORT_CANDIDATES_LATER: candidates are confirmed on the S7-c screen';
  end if;
  if (p_file ->> 'kind') is distinct from 'sheet' or coalesce(p_file ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(coalesce(p_file -> 'id_prefixes', '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'LEDGER_IMPORT_BAD_FILE: kind, sha256 or id_prefixes';
  end if;
  foreach v_key in array array['topics', 'organizations', 'sources', 'records', 'record_sources', 'links', 'legacy_write_requests'] loop
    if pg_catalog.jsonb_typeof(coalesce(p_file -> v_key, '[]'::jsonb)) <> 'array'
       or pg_catalog.jsonb_array_length(coalesce(p_file -> v_key, '[]'::jsonb)) > 20000
       or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(p_file -> v_key, '[]'::jsonb)) e
         where pg_catalog.jsonb_typeof(e) <> 'object') then
      raise exception using errcode = '22023', message = 'LEDGER_IMPORT_BAD_FILE: ' || v_key;
    end if;
  end loop;
  -- 가져온 행은 시트 ID를 그대로 가져야 한다(빈 ID면 DB가 새 번호를 붙이므로 막는다).
  if exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(p_file -> 'topics', '[]'::jsonb)
                || coalesce(p_file -> 'organizations', '[]'::jsonb) || coalesce(p_file -> 'sources', '[]'::jsonb)
                || coalesce(p_file -> 'records', '[]'::jsonb)) e
             where coalesce(e ->> 'ledger_id', '') = '') then
    raise exception using errcode = '22023', message = 'LEDGER_IMPORT_BAD_FILE: every imported row needs its sheet id';
  end if;
  if exists (select 1 from public.app_ledger_imports i
             where i.workspace_id = p_workspace_id and i.file_sha256 = (p_file ->> 'sha256') and i.status in ('applied', 'confirmed')) then
    raise exception using errcode = '23505', message = 'LEDGER_IMPORT_DUPLICATE_FILE: this file was already imported';
  end if;
  v_counts := pg_catalog.jsonb_build_object(
    'topics', pg_catalog.jsonb_array_length(coalesce(p_file -> 'topics', '[]'::jsonb)),
    'organizations', pg_catalog.jsonb_array_length(coalesce(p_file -> 'organizations', '[]'::jsonb)),
    'sources', pg_catalog.jsonb_array_length(coalesce(p_file -> 'sources', '[]'::jsonb)),
    'records', pg_catalog.jsonb_array_length(coalesce(p_file -> 'records', '[]'::jsonb)),
    'record_sources', pg_catalog.jsonb_array_length(coalesce(p_file -> 'record_sources', '[]'::jsonb)),
    'links', pg_catalog.jsonb_array_length(coalesce(p_file -> 'links', '[]'::jsonb)),
    'legacy_write_requests', pg_catalog.jsonb_array_length(coalesce(p_file -> 'legacy_write_requests', '[]'::jsonb)),
    'report', coalesce(p_file -> 'report', '{}'::jsonb));

  begin
    -- 1) 번호표 접두어: 없으면 등록, 있으면 같아야 한다.
    for v_scope, v_prefix in select e.key, e.value from pg_catalog.jsonb_each_text(coalesce(p_file -> 'id_prefixes', '{}'::jsonb)) e loop
      select c.prefix into v_existing from public.app_ledger_id_counters c
      where c.workspace_id = p_workspace_id and c.scope = v_scope;
      if v_existing is null then
        insert into public.app_ledger_id_counters (workspace_id, scope, prefix) values (p_workspace_id, v_scope, v_prefix);
        v_registered := v_registered || (v_scope || ':' || v_prefix);
      elsif v_existing <> v_prefix then
        raise exception using errcode = '23514', message = 'LEDGER_IMPORT_PREFIX_MISMATCH: ' || v_scope || ' uses ' || v_existing;
      end if;
    end loop;

    -- 2) 묶음 1행(파일 지문은 유일 색인으로 한 번 더 막힌다).
    insert into public.app_ledger_imports (workspace_id, label, source_kind, file_sha256, row_counts)
    values (p_workspace_id, coalesce(p_file ->> 'label', ''),
      case when (p_file ->> 'source_kind') = 'claude_file' then 'claude_file' else 'sheet_csv' end,
      p_file ->> 'sha256', v_counts)
    returning id into v_import;

    -- 3) 주제·조직·출처.
    insert into public.app_ledger_topics (workspace_id, ledger_id, name, aliases, description, status, sort_order, import_id)
    select p_workspace_id, x.ledger_id, x.name, coalesce(x.aliases, '{}'), coalesce(x.description, ''),
      coalesce(x.status, 'active'), coalesce(x.sort_order, 0), v_import
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'topics', '[]'::jsonb))
      as x(ledger_id text, name text, aliases text[], description text, status text, sort_order integer);
    insert into public.app_ledger_organizations (workspace_id, ledger_id, name, aliases, suborganization_id, note, status, import_id)
    select p_workspace_id, x.ledger_id, x.name, coalesce(x.aliases, '{}'), x.suborganization_id, coalesce(x.note, ''),
      coalesce(x.status, 'active'), v_import
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'organizations', '[]'::jsonb))
      as x(ledger_id text, name text, aliases text[], suborganization_id uuid, note text, status text);
    insert into public.app_ledger_sources (workspace_id, ledger_id, title, doc_type, location, drive_file_id, source_date, coverage,
      processing_status, sensitivity, note, status, import_id)
    select p_workspace_id, x.ledger_id, x.title, coalesce(x.doc_type, 'other'), coalesce(x.location, ''), x.drive_file_id, x.source_date,
      coalesce(x.coverage, ''), coalesce(x.processing_status, 'unprocessed'), coalesce(x.sensitivity, 'S1'), coalesce(x.note, ''),
      coalesce(x.status, 'active'), v_import
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'sources', '[]'::jsonb))
      as x(ledger_id text, title text, doc_type text, location text, drive_file_id text, source_date date, coverage text,
        processing_status text, sensitivity text, note text, status text);

    -- 4) 기록: 대체기록(superseded_by)이 먼저 있어야 하므로, 가리키는 기록이 들어간 것부터 차례로 넣는다(고침 없이 넣기만).
    --    주제·대체기록은 파일 안 또는 이미 원장에 있는 ID. 끝까지 못 넣은 기록이 있으면 깨진 참조(또는 순환)로 묶음 전체 거절.
    loop
      v_pass := v_pass + 1;
      insert into public.app_ledger_records (workspace_id, kind, ledger_id, title, summary, scope, topic_id, sensitivity, importance,
        validity, confidence, verification, date_start, date_end, date_precision, date_note, event_status, decision_type,
        decision_reason, evidence_type, counterparty, commitment_status, follow_up_on, superseded_by, supersede_reason, note, import_id)
      select p_workspace_id, x.kind, x.ledger_id, x.title, coalesce(x.summary, ''), coalesce(x.scope, 'work'), t.id,
        coalesce(x.sensitivity, 'S1'), coalesce(x.importance, 'normal'), coalesce(x.validity, 'current'), x.confidence, x.verification,
        x.date_start, x.date_end, coalesce(x.date_precision, 'unknown'), coalesce(x.date_note, ''), x.event_status, x.decision_type,
        x.decision_reason, x.evidence_type, x.counterparty, x.commitment_status, x.follow_up_on, sup.id, x.supersede_reason,
        coalesce(x.note, ''), v_import
      from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'records', '[]'::jsonb))
        as x(kind text, ledger_id text, title text, summary text, scope text, topic text, sensitivity text, importance text,
          validity text, confidence text, verification text, date_start date, date_end date, date_precision text, date_note text,
          event_status text, decision_type text, decision_reason text, evidence_type text, counterparty text,
          commitment_status text, follow_up_on date, superseded_by text, supersede_reason text, note text)
      left join public.app_ledger_topics t on t.workspace_id = p_workspace_id and t.ledger_id = x.topic
      left join public.app_ledger_records sup on sup.workspace_id = p_workspace_id and sup.ledger_id = x.superseded_by
      where (x.topic is null or t.id is not null)
        and (x.superseded_by is null or sup.id is not null)
        and not exists (select 1 from public.app_ledger_records r
          where r.workspace_id = p_workspace_id and r.import_id = v_import and r.ledger_id = x.ledger_id);
      get diagnostics v_n = row_count;
      exit when v_n = 0 or v_pass > 1000;
    end loop;
    select pg_catalog.string_agg(m.ledger_id, ', ') into v_missing
    from (select x.ledger_id || ' → ' || coalesce(x.superseded_by, x.topic) as ledger_id
          from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'records', '[]'::jsonb)) as x(ledger_id text, topic text, superseded_by text)
          where not exists (select 1 from public.app_ledger_records r
            where r.workspace_id = p_workspace_id and r.import_id = v_import and r.ledger_id = x.ledger_id)
          limit 20) m;
    if v_missing is not null then
      raise exception using errcode = '23503', message = 'LEDGER_IMPORT_BROKEN_REF: ' || v_missing;
    end if;

    -- 5) 기록-출처 연결(근거위치 포함). 기록·출처는 파일 안 또는 이미 원장에 있는 ID.
    insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator, note, import_id)
    select p_workspace_id, r.id, s.id, coalesce(x.locator, ''), coalesce(x.note, ''), v_import
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'record_sources', '[]'::jsonb))
      as x(record text, source text, locator text, note text)
    join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = x.record
    join public.app_ledger_sources s on s.workspace_id = p_workspace_id and s.ledger_id = x.source;
    get diagnostics v_n = row_count;
    if v_n <> pg_catalog.jsonb_array_length(coalesce(p_file -> 'record_sources', '[]'::jsonb)) then
      select pg_catalog.string_agg(m.ref, ', ') into v_missing
      from (select x.record || ' → ' || x.source as ref
            from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'record_sources', '[]'::jsonb)) as x(record text, source text)
            left join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = x.record
            left join public.app_ledger_sources s on s.workspace_id = p_workspace_id and s.ledger_id = x.source
            where r.id is null or s.id is null
            limit 20) m;
      raise exception using errcode = '23503', message = 'LEDGER_IMPORT_BROKEN_REF: ' || coalesce(v_missing, 'record_sources');
    end if;

    -- 6) 기록 간 연결(변화기록 → 사건 소속 등)과 조직 연결. 대상은 기록 또는 원장 조직 중 정확히 하나.
    insert into public.app_ledger_links (workspace_id, record_id, target_record_id, target_organization_id, relation, note, import_id)
    select p_workspace_id, r.id, tr.id, o.id, x.relation, coalesce(x.note, ''), v_import
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'links', '[]'::jsonb))
      as x(record text, target_record text, target_organization text, relation text, note text)
    join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = x.record
    left join public.app_ledger_records tr on tr.workspace_id = p_workspace_id and tr.ledger_id = x.target_record
    left join public.app_ledger_organizations o on o.workspace_id = p_workspace_id and o.ledger_id = x.target_organization
    where (x.target_record is null) <> (x.target_organization is null)
      and (x.target_record is null or tr.id is not null)
      and (x.target_organization is null or o.id is not null);
    get diagnostics v_n = row_count;
    if v_n <> pg_catalog.jsonb_array_length(coalesce(p_file -> 'links', '[]'::jsonb)) then
      select pg_catalog.string_agg(m.ref, ', ') into v_missing
      from (select x.record || ' → ' || coalesce(x.target_record, x.target_organization, '?') as ref
            from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'links', '[]'::jsonb))
              as x(record text, target_record text, target_organization text)
            left join public.app_ledger_records r on r.workspace_id = p_workspace_id and r.ledger_id = x.record
            left join public.app_ledger_records tr on tr.workspace_id = p_workspace_id and tr.ledger_id = x.target_record
            left join public.app_ledger_organizations o on o.workspace_id = p_workspace_id and o.ledger_id = x.target_organization
            where r.id is null or (x.target_record is null) = (x.target_organization is null)
              or (x.target_record is not null and tr.id is null) or (x.target_organization is not null and o.id is null)
            limit 20) m;
      raise exception using errcode = '23503', message = 'LEDGER_IMPORT_BROKEN_REF: ' || coalesce(v_missing, 'links');
    end if;

    -- 7) 옛 쓰기요청 → 감사 기록(legacy_write_request). 같은 옛 ID는 유일 색인으로 한 번만.
    insert into public.app_ledger_audit (workspace_id, event, legacy_id, import_id, occurred_at, detail)
    select p_workspace_id, 'legacy_write_request', x.legacy_id, v_import, x.occurred_at, coalesce(x.detail, '{}'::jsonb)
    from pg_catalog.jsonb_to_recordset(coalesce(p_file -> 'legacy_write_requests', '[]'::jsonb))
      as x(legacy_id text, occurred_at timestamptz, detail jsonb);

    -- 8) 넣은 수가 파일 행 수와 같은지 확인하고 감사 기록 1행.
    v_result := public.app_import_ledger_counts(v_import);
    if (v_result ->> 'topics')::integer <> (v_counts ->> 'topics')::integer
       or (v_result ->> 'organizations')::integer <> (v_counts ->> 'organizations')::integer
       or (v_result ->> 'sources')::integer <> (v_counts ->> 'sources')::integer
       or (v_result ->> 'records')::integer <> (v_counts ->> 'records')::integer
       or (v_result ->> 'record_sources')::integer <> (v_counts ->> 'record_sources')::integer
       or (v_result ->> 'links')::integer <> (v_counts ->> 'links')::integer
       or (v_result ->> 'legacy_write_requests')::integer <> (v_counts ->> 'legacy_write_requests')::integer then
      raise exception using errcode = '23514', message = 'LEDGER_IMPORT_COUNT_MISMATCH';
    end if;
    insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, import_id, detail)
    values (p_workspace_id, 'import_applied', 'imports', v_import, v_import,
      pg_catalog.jsonb_build_object('counts', v_counts - 'report', 'registered_prefixes', pg_catalog.to_jsonb(v_registered)));
    v_result := v_result || pg_catalog.jsonb_build_object('dry_run', p_dry_run, 'registered_prefixes', pg_catalog.to_jsonb(v_registered));
    if p_dry_run then
      raise exception using errcode = 'LDRY1', message = 'LEDGER_IMPORT_DRY_RUN';
    end if;
  exception
    when sqlstate 'LDRY1' then
      -- 해 보기: 위에서 쓴 것은 모두 취소됐다. 센 개수만 돌려준다(묶음 ID는 없음).
      return v_result || pg_catalog.jsonb_build_object('import_id', null, 'status', 'dry_run');
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name, v_detail = pg_exception_detail;
      if v_constraint = 'app_ledger_imports_file_key' then
        raise exception using errcode = '23505', message = 'LEDGER_IMPORT_DUPLICATE_FILE: this file was already imported';
      end if;
      raise exception using errcode = '23505',
        message = 'LEDGER_IMPORT_EXISTING_ID: ' || coalesce(v_constraint, '') || ' ' || pg_catalog.left(coalesce(v_detail, ''), 300);
  end;
  return v_result;
end
$$;

-- 확인: 숫자 대조를 마친 묶음을 잠근다(되돌리기 불가).
create function public.app_import_ledger_confirm(p_import_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  update public.app_ledger_imports set status = 'confirmed', decided_at = pg_catalog.now()
  where id = p_import_id and status = 'applied'
  returning workspace_id into v_workspace;
  if v_workspace is null then
    raise exception using errcode = '55000', message = 'LEDGER_IMPORT_NOT_OPEN: only an applied import can be confirmed';
  end if;
  insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, import_id, detail)
  values (v_workspace, 'import_confirmed', 'imports', p_import_id, p_import_id, '{}'::jsonb);
  return public.app_import_ledger_counts(p_import_id);
end
$$;

-- 되돌리기: 확인 전(applied) 묶음만. 그 묶음에서 들어와 고친 적 없는 행만 지울 수 있으므로(20261021082000 제한 정책)
-- 고친 행이 하나라도 있거나, 다른 행(손으로 붙인 연결·후보 등)이 그 묶음 행을 가리키면 아무것도 지우지 않고 멈춘다.
-- 지운 행은 감사 기록(row_delete)에 남고, 번호표는 줄지 않는다(빈 번호 재사용 금지).
create function public.app_import_ledger_revert(p_import_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status text;
  v_before jsonb;
  v_constraint text;
begin
  select i.workspace_id, i.status into v_workspace, v_status
  from public.app_ledger_imports i where i.id = p_import_id
  for update;
  if v_workspace is null or v_status <> 'applied' then
    raise exception using errcode = '55000', message = 'LEDGER_IMPORT_NOT_OPEN: only an applied import can be reverted';
  end if;
  v_before := public.app_import_ledger_counts(p_import_id);
  if (v_before ->> 'modified')::integer > 0 then
    raise exception using errcode = '55000',
      message = 'LEDGER_IMPORT_MODIFIED: ' || (v_before ->> 'modified') || ' rows were changed after the import';
  end if;
  begin
    delete from public.app_ledger_links where import_id = p_import_id;
    delete from public.app_ledger_record_sources where import_id = p_import_id;
    delete from public.app_ledger_audit where import_id = p_import_id and event = 'legacy_write_request';
    delete from public.app_ledger_records where import_id = p_import_id;
    delete from public.app_ledger_sources where import_id = p_import_id;
    delete from public.app_ledger_organizations where import_id = p_import_id;
    delete from public.app_ledger_topics where import_id = p_import_id;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception using errcode = '23503',
        message = 'LEDGER_IMPORT_REVERT_BLOCKED: other rows point to this import (' || coalesce(v_constraint, '') || ')';
  end;
  -- RLS 제한 정책이 조용히 남긴 행이 있으면 멈춘다(전부 아니면 전무).
  if exists (select 1 from public.app_ledger_records r where r.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_sources s where s.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_organizations o where o.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_topics t where t.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_links l where l.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_record_sources rs where rs.import_id = p_import_id)
     or exists (select 1 from public.app_ledger_audit a where a.import_id = p_import_id and a.event = 'legacy_write_request') then
    raise exception using errcode = '55000', message = 'LEDGER_IMPORT_REVERT_INCOMPLETE';
  end if;
  update public.app_ledger_imports set status = 'reverted', decided_at = pg_catalog.now()
  where id = p_import_id and status = 'applied';
  insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, import_id, detail)
  values (v_workspace, 'import_reverted', 'imports', p_import_id, p_import_id,
    pg_catalog.jsonb_build_object('deleted', v_before - 'file' - 'label' - 'status' - 'created_at' - 'decided_at' - 'import_id'));
  return public.app_import_ledger_counts(p_import_id);
end
$$;

revoke all on function public.app_import_ledger_counts(uuid) from public, anon, service_role;
revoke all on function public.app_import_ledger_apply(uuid, jsonb, boolean) from public, anon, service_role;
revoke all on function public.app_import_ledger_confirm(uuid) from public, anon, service_role;
revoke all on function public.app_import_ledger_revert(uuid) from public, anon, service_role;
grant execute on function public.app_import_ledger_counts(uuid) to authenticated;
grant execute on function public.app_import_ledger_apply(uuid, jsonb, boolean) to authenticated;
grant execute on function public.app_import_ledger_confirm(uuid) to authenticated;
grant execute on function public.app_import_ledger_revert(uuid) to authenticated;

-- 사후 확인: 함수 4개 모두 INVOKER·search_path 빈칸, anon·PUBLIC·service_role 실행 권한 없음.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'app\_import\_ledger\_%'
          and not p.prosecdef and p.proconfig = array['search_path=""']
          and p.proacl is not null and p.proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 4 then
    raise exception 'LEDGER_IMPORT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021150000', 'ledger_import', array['S7-b: app_import_ledger_apply (one transaction, dry-run rolls back), app_import_ledger_counts, app_import_ledger_confirm, app_import_ledger_revert; all SECURITY INVOKER, authenticated only']);
commit;
