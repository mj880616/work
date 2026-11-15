begin;
-- AI-서버연동 S7-a: 업무 원장(사건DB)을 Web2로 옮기기 위한 표·권한·검색 RPC. 설계: docs/design/ledger-web2.md
-- 새 표 10개 + 트리거 18개(트리거 함수 5개) + 검색 함수 1개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다.
-- 모든 표: RLS 켬, owner 정책(private.app_is_workspace_owner)만, PUBLIC·anon·service_role 권한 없음.
--   authenticated는 필요한 동작·칸만. 원장 행(기록·출처·조직·주제)은 지우지 않고 대체·폐기 상태로 둔다
--   (예외: 확인 전 가져오기 묶음 되돌리기, 제한 정책). 고침·지움은 감사 기록(app_ledger_audit)에 남는다.
-- 고정 목록은 CHECK(값 목록), 고정 ID는 표별 접두어+4~6자리 번호(app_ledger_id_counters, 빈 번호 재사용 금지).
-- 함수는 모두 SECURITY INVOKER·search_path 빈칸. SECURITY DEFINER 없음.
-- 정책·트리거가 있어 승인형 DB workflow 검사가 거절하므로 SQL Editor(폰 경로 C) 전용. 짝: docs/20261021082000_ledger_schema.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르거나 이미 적용됐으면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021082000')
     or to_regclass('public.app_ledger_imports') is not null
     or to_regclass('public.app_ledger_id_counters') is not null
     or to_regclass('public.app_ledger_topics') is not null
     or to_regclass('public.app_ledger_organizations') is not null
     or to_regclass('public.app_ledger_sources') is not null
     or to_regclass('public.app_ledger_records') is not null
     or to_regclass('public.app_ledger_record_sources') is not null
     or to_regclass('public.app_ledger_links') is not null
     or to_regclass('public.app_ledger_candidates') is not null
     or to_regclass('public.app_ledger_audit') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.proname like 'app\_ledger\_%')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_meetings') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_meeting_in_workspace(uuid,uuid)') and prosecdef) then
    raise exception 'LEDGER_SCHEMA_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 가져오기 묶음: 시트 CSV·Claude 가져오기 파일 한 번 = 한 줄. 같은 파일(sha256)은 되돌리기 전에는 두 번 못 넣는다.
--    상태: 적용(applied, 되돌리기 가능) → 확인(confirmed, 잠김) 또는 되돌림(reverted). 한 번 정하면 못 바꾼다(트리거).
create table public.app_ledger_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  label text not null,
  source_kind text not null,
  file_sha256 text not null,
  row_counts jsonb not null default '{}'::jsonb,
  status text not null default 'applied',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_ledger_imports_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_imports_label_check check (char_length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]'),
  constraint app_ledger_imports_source_kind_check check (source_kind in ('sheet_csv', 'claude_file', 'other')),
  constraint app_ledger_imports_sha_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint app_ledger_imports_counts_check check (jsonb_typeof(row_counts) = 'object' and octet_length(row_counts::text) <= 4096),
  constraint app_ledger_imports_status_check check (
    status in ('applied', 'confirmed', 'reverted') and (status = 'applied') = (decided_at is null))
);
create unique index app_ledger_imports_file_key on public.app_ledger_imports(workspace_id, file_sha256)
  where status in ('applied', 'confirmed');

-- 2) 고정 ID 번호표: 범위(종류)마다 접두어와 마지막 번호. 번호는 줄어들지 않는다(빈 번호 재사용 금지).
create table public.app_ledger_id_counters (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  scope text not null,
  prefix text not null,
  last_number integer not null default 0,
  primary key (workspace_id, scope),
  constraint app_ledger_id_counters_scope_check check (
    scope in ('event', 'change', 'decision', 'evidence', 'commitment', 'source', 'organization', 'topic')),
  constraint app_ledger_id_counters_prefix_check check (prefix ~ '^[A-Z]{2,6}$'),
  constraint app_ledger_id_counters_number_check check (last_number between 0 and 999999),
  constraint app_ledger_id_counters_prefix_key unique (workspace_id, prefix)
);

-- 3) 업무주제 사전: 자유 입력 분야·관련업무를 대신하는 30~40개 주제 + 별칭 + Web2 프로젝트 연결(선택).
create table public.app_ledger_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  ledger_id text not null,
  name text not null,
  aliases text[] not null default '{}',
  description text not null default '',
  project_id uuid references public.app_spaces(id) on delete set null,
  status text not null default 'active',
  sort_order integer not null default 0,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ledger_topics_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_topics_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_topics_ledger_id_key unique (workspace_id, ledger_id),
  constraint app_ledger_topics_name_key unique (workspace_id, name),
  constraint app_ledger_topics_name_check check (char_length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  constraint app_ledger_topics_aliases_check check (
    cardinality(aliases) <= 20 and array_position(aliases, null) is null
    and char_length(array_to_string(aliases, '')) <= 1000 and array_to_string(aliases, '|') !~ '[[:cntrl:]]'),
  constraint app_ledger_topics_description_check check (char_length(description) <= 500),
  constraint app_ledger_topics_status_check check (status in ('active', 'retired'))
);

-- 4) 원장 조직: 옛 ORG ID를 유지하고, Web2 담당조직(app_suborganizations)과는 선택 연결(한 조직에 하나).
create table public.app_ledger_organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  ledger_id text not null,
  name text not null,
  aliases text[] not null default '{}',
  suborganization_id uuid references public.app_suborganizations(id) on delete set null,
  note text not null default '',
  status text not null default 'active',
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ledger_organizations_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_organizations_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_organizations_ledger_id_key unique (workspace_id, ledger_id),
  constraint app_ledger_organizations_name_check check (char_length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  constraint app_ledger_organizations_aliases_check check (
    cardinality(aliases) <= 20 and array_position(aliases, null) is null
    and char_length(array_to_string(aliases, '')) <= 1000 and array_to_string(aliases, '|') !~ '[[:cntrl:]]'),
  constraint app_ledger_organizations_note_check check (char_length(note) <= 2000),
  constraint app_ledger_organizations_status_check check (status in ('active', 'retired'))
);
create unique index app_ledger_organizations_web2_key on public.app_ledger_organizations(suborganization_id)
  where suborganization_id is not null;

-- 5) 출처: 원문은 복제하지 않고 위치·처리범위·처리상태만. 문서종류는 고정 목록.
create table public.app_ledger_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  ledger_id text not null,
  title text not null,
  doc_type text not null default 'other',
  location text not null default '',
  drive_file_id text,
  source_date date,
  coverage text not null default '',
  processing_status text not null default 'unprocessed',
  sensitivity text not null default 'S1',
  note text not null default '',
  status text not null default 'active',
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ledger_sources_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_sources_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_sources_ledger_id_key unique (workspace_id, ledger_id),
  constraint app_ledger_sources_title_check check (char_length(btrim(title)) between 1 and 300 and title !~ '[[:cntrl:]]'),
  constraint app_ledger_sources_doc_type_check check (doc_type in (
    'meeting_material', 'minutes', 'official_letter', 'news', 'statement', 'law', 'gov_report',
    'bargaining', 'call_transcript', 'telegram', 'email', 'ai_chat', 'internal_doc', 'other')),
  constraint app_ledger_sources_location_check check (char_length(location) <= 2000 and location !~ '[[:cntrl:]]'),
  constraint app_ledger_sources_drive_check check (drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint app_ledger_sources_coverage_check check (char_length(coverage) <= 1000),
  constraint app_ledger_sources_processing_check check (processing_status in ('unprocessed', 'partial', 'done')),
  constraint app_ledger_sources_sensitivity_check check (sensitivity in ('S0', 'S1', 'S2')),
  constraint app_ledger_sources_note_check check (char_length(note) <= 2000),
  constraint app_ledger_sources_status_check check (status in ('active', 'retired'))
);

-- 6) 원장 기록: 사건·변화기록·결정·근거·약속을 한 표에. 종류별 칸은 그 종류에서만 채운다.
create table public.app_ledger_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null,
  ledger_id text not null,
  title text not null,
  summary text not null default '',
  scope text not null default 'work',
  topic_id uuid,
  sensitivity text not null default 'S1',
  importance text not null default 'normal',
  validity text not null default 'current',
  confidence text,
  verification text,
  date_start date,
  date_end date,
  date_precision text not null default 'unknown',
  date_note text not null default '',
  event_status text,
  decision_type text,
  decision_reason text,
  evidence_type text,
  counterparty text,
  commitment_status text,
  follow_up_on date,
  superseded_by uuid,
  supersede_reason text,
  note text not null default '',
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ledger_records_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_records_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_records_topic_fk foreign key (workspace_id, topic_id) references public.app_ledger_topics(workspace_id, id),
  constraint app_ledger_records_superseded_fk foreign key (workspace_id, superseded_by) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_records_ledger_id_key unique (workspace_id, ledger_id),
  constraint app_ledger_records_kind_check check (kind in ('event', 'change', 'decision', 'evidence', 'commitment')),
  constraint app_ledger_records_title_check check (char_length(btrim(title)) between 1 and 300 and title !~ '[[:cntrl:]]'),
  constraint app_ledger_records_summary_check check (char_length(summary) <= 4000),
  constraint app_ledger_records_scope_check check (scope in ('work', 'interest')),
  constraint app_ledger_records_sensitivity_check check (sensitivity in ('S0', 'S1', 'S2')),
  constraint app_ledger_records_importance_check check (importance in ('very_high', 'high', 'normal', 'low')),
  constraint app_ledger_records_validity_check check (validity in ('current', 'fulfilled', 'superseded', 'retired', 'needs_check')),
  constraint app_ledger_records_confidence_check check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint app_ledger_records_verification_check check (verification is null or verification in ('verified', 'partial', 'unverified')),
  -- 기준일 정밀도: 모름이면 날짜 없음, 일·월·연은 시작일(월=1일, 연=1월 1일), 기간은 시작<끝. 원래 표기는 date_note에.
  constraint app_ledger_records_date_check check (
    date_precision in ('day', 'month', 'year', 'range', 'unknown')
    and (date_end is null or (date_start is not null and date_end >= date_start))
    and case date_precision
      when 'unknown' then date_start is null and date_end is null
      when 'day' then date_start is not null and (date_end is null or date_end = date_start)
      when 'month' then date_start is not null and extract(day from date_start) = 1
      when 'year' then date_start is not null and extract(month from date_start) = 1 and extract(day from date_start) = 1
      else date_start is not null and date_end is not null and date_end > date_start end),
  constraint app_ledger_records_date_note_check check (char_length(date_note) <= 200 and date_note !~ '[[:cntrl:]]'),
  -- 사건 상태 하나(추적중·관찰·종료·보류): 사건만, 사건이면 꼭.
  constraint app_ledger_records_event_check check (
    (kind = 'event') = (event_status is not null)
    and (event_status is null or event_status in ('tracking', 'watching', 'closed', 'on_hold'))),
  -- 결정유형(채택·기각·보류·변경)과 결정이유: 결정에서만(옛 결정은 비어 있어도 됨).
  constraint app_ledger_records_decision_check check (
    (kind = 'decision' or (decision_type is null and decision_reason is null))
    and (decision_type is null or decision_type in ('adopted', 'rejected', 'on_hold', 'changed'))
    and (decision_reason is null or char_length(decision_reason) between 1 and 2000)),
  constraint app_ledger_records_evidence_check check (
    (kind = 'evidence' or evidence_type is null)
    and (evidence_type is null or evidence_type in (
      'law', 'statistics', 'budget', 'agreement', 'precedent', 'gov_position',
      'counterpart_statement', 'field_fact', 'argument', 'other'))),
  -- 약속(COM): 상대측·이행상태가 꼭 있고, 후속확인일은 약속에서만.
  constraint app_ledger_records_commitment_check check (
    (kind = 'commitment') = (counterparty is not null and commitment_status is not null)
    and (kind = 'commitment' or (counterparty is null and commitment_status is null and follow_up_on is null))
    and (counterparty is null or (char_length(btrim(counterparty)) between 1 and 200 and counterparty !~ '[[:cntrl:]]'))
    and (commitment_status is null or commitment_status in ('waiting', 'fulfilled', 'broken', 'cancelled'))),
  -- 대체: 대체기록이 있으면 유효상태는 '대체', '대체'면 대체기록이 꼭 있다. 자기 자신 불가.
  constraint app_ledger_records_supersede_check check (
    (validity = 'superseded') = (superseded_by is not null)
    and (superseded_by is null or superseded_by <> id)
    and (supersede_reason is null or char_length(supersede_reason) between 1 and 1000)),
  constraint app_ledger_records_note_check check (char_length(note) <= 4000)
);
create index app_ledger_records_list_idx on public.app_ledger_records(workspace_id, kind, date_start desc);
create index app_ledger_records_topic_idx on public.app_ledger_records(topic_id) where topic_id is not null;
create index app_ledger_records_superseded_idx on public.app_ledger_records(superseded_by) where superseded_by is not null;
create index app_ledger_records_follow_up_idx on public.app_ledger_records(workspace_id, follow_up_on)
  where kind = 'commitment' and commitment_status = 'waiting';

-- 7) 기록-출처 연결표: 출처마다 한 줄, 근거위치(쪽·조항·시각)도 그 줄에.
create table public.app_ledger_record_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  record_id uuid not null,
  source_id uuid not null,
  locator text not null default '',
  note text not null default '',
  import_id uuid,
  created_at timestamptz not null default now(),
  constraint app_ledger_record_sources_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_record_sources_record_fk foreign key (workspace_id, record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_record_sources_source_fk foreign key (workspace_id, source_id) references public.app_ledger_sources(workspace_id, id),
  constraint app_ledger_record_sources_key unique (record_id, source_id, locator),
  constraint app_ledger_record_sources_locator_check check (char_length(locator) <= 500 and locator !~ '[[:cntrl:]]'),
  constraint app_ledger_record_sources_note_check check (char_length(note) <= 500)
);
create index app_ledger_record_sources_source_idx on public.app_ledger_record_sources(source_id);

-- 8) 기록 간 연결표: 기록 → 기록(소속·후속·뒷받침·반박·관련) / 원장 조직(옛 조직연결 5종) / Web2 프로젝트·회의(관련).
--    소속(belongs_to) = 변화기록 → 그 사건. Web2 프로젝트·회의가 지워지면 그 연결만 사라진다(감사 기록에 남음).
create table public.app_ledger_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  record_id uuid not null,
  target_record_id uuid,
  target_organization_id uuid,
  target_project_id uuid references public.app_spaces(id) on delete cascade,
  target_meeting_id uuid references public.app_meetings(id) on delete cascade,
  relation text not null,
  note text not null default '',
  import_id uuid,
  created_at timestamptz not null default now(),
  constraint app_ledger_links_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_links_record_fk foreign key (workspace_id, record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_links_target_record_fk foreign key (workspace_id, target_record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_links_target_org_fk foreign key (workspace_id, target_organization_id) references public.app_ledger_organizations(workspace_id, id),
  constraint app_ledger_links_one_target check (
    num_nonnulls(target_record_id, target_organization_id, target_project_id, target_meeting_id) = 1),
  constraint app_ledger_links_not_self check (target_record_id is null or target_record_id <> record_id),
  constraint app_ledger_links_relation_check check (
    case
      when target_record_id is not null then relation in ('belongs_to', 'follow_up', 'supports', 'contradicts', 'related')
      when target_organization_id is not null then relation in ('direct', 'joint', 'counterpart', 'reference', 'other')
      else relation = 'related' end),
  constraint app_ledger_links_note_check check (char_length(note) <= 500),
  constraint app_ledger_links_unique unique nulls not distinct
    (record_id, target_record_id, target_organization_id, target_project_id, target_meeting_id, relation)
);
create index app_ledger_links_target_record_idx on public.app_ledger_links(target_record_id) where target_record_id is not null;
create index app_ledger_links_target_org_idx on public.app_ledger_links(target_organization_id) where target_organization_id is not null;
create index app_ledger_links_target_project_idx on public.app_ledger_links(target_project_id) where target_project_id is not null;
create index app_ledger_links_target_meeting_idx on public.app_ledger_links(target_meeting_id) where target_meeting_id is not null;

-- 9) 원장 후보: 원장에 들어가는 문은 "후보 → 사용자 확정" 하나. 출처 3가지, 상태 대기·확정·버림.
--    내용(payload)의 모양 검사·확정 처리는 S7-c 확정 함수가 한다. 결정된 후보는 고칠 수 없다(트리거).
create table public.app_ledger_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  origin text not null,
  status text not null default 'pending',
  action text not null default 'new',
  kind text not null,
  target_record_id uuid,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  sensitivity text not null default 'S1',
  dedup_key text,
  import_id uuid,
  result_record_id uuid,
  discard_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint app_ledger_candidates_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_candidates_target_fk foreign key (workspace_id, target_record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_candidates_result_fk foreign key (workspace_id, result_record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_candidates_origin_check check (origin in ('web2_ai', 'claude_import', 'user')),
  constraint app_ledger_candidates_import_check check ((origin = 'claude_import') = (import_id is not null)),
  constraint app_ledger_candidates_status_check check (
    status in ('pending', 'confirmed', 'discarded')
    and (status = 'pending') = (decided_at is null)
    and (status <> 'confirmed' or result_record_id is not null)
    and (status = 'discarded' or discard_reason is null)),
  constraint app_ledger_candidates_action_check check (
    action in ('new', 'add_source', 'update', 'supersede') and (action = 'new') = (target_record_id is null)),
  constraint app_ledger_candidates_kind_check check (kind in ('event', 'change', 'decision', 'evidence', 'commitment')),
  constraint app_ledger_candidates_title_check check (char_length(btrim(title)) between 1 and 300 and title !~ '[[:cntrl:]]'),
  constraint app_ledger_candidates_payload_check check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  -- S3(개인 민감)는 어디에도 저장하지 않는다. AI·가져오기는 S3 항목을 버리고 개수만 보고한다.
  constraint app_ledger_candidates_sensitivity_check check (sensitivity in ('S0', 'S1', 'S2')),
  constraint app_ledger_candidates_dedup_check check (dedup_key is null or (char_length(dedup_key) between 1 and 300 and dedup_key !~ '[[:cntrl:]]')),
  constraint app_ledger_candidates_reason_check check (discard_reason is null or char_length(discard_reason) between 1 and 500)
);
create index app_ledger_candidates_list_idx on public.app_ledger_candidates(workspace_id, status, created_at desc);
create unique index app_ledger_candidates_pending_dedup_key on public.app_ledger_candidates(workspace_id, dedup_key)
  where status = 'pending' and dedup_key is not null;

-- 10) 감사 기록: 쌓기만 한다(UPDATE·DELETE 권한 없음). 옛 쓰기요청 행, 기록 고침 전 값, 후보 결정, 가져오기·되돌리기.
create table public.app_ledger_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  event text not null,
  target_table text,
  target_id uuid,
  legacy_id text,
  import_id uuid,
  occurred_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint app_ledger_audit_import_fk foreign key (workspace_id, import_id) references public.app_ledger_imports(workspace_id, id),
  constraint app_ledger_audit_event_check check (event in (
    'legacy_write_request', 'row_update', 'row_delete', 'candidate_decided', 'import_applied', 'import_confirmed',
    'import_reverted', 'note')),
  constraint app_ledger_audit_target_check check (
    (target_table is null) = (target_id is null)
    and (target_table is null or target_table in (
      'records', 'sources', 'organizations', 'topics', 'record_sources', 'links', 'candidates', 'imports'))),
  constraint app_ledger_audit_legacy_check check (legacy_id is null or legacy_id ~ '^[A-Z]{2,6}-[0-9]{1,6}$'),
  constraint app_ledger_audit_detail_check check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 65536)
);
create index app_ledger_audit_list_idx on public.app_ledger_audit(workspace_id, created_at desc);
create index app_ledger_audit_target_idx on public.app_ledger_audit(target_id) where target_id is not null;
create unique index app_ledger_audit_legacy_key on public.app_ledger_audit(workspace_id, legacy_id)
  where event = 'legacy_write_request';

-- 트리거 함수(모두 SECURITY INVOKER, search_path 빈칸, 직접 실행 권한 없음).
-- 고정 ID: 비어 있으면 번호표에서 다음 번호. 직접 적은 ID는 가져오기(import_id)일 때만, 접두어·형식이 맞아야 한다.
create function private.app_ledger_assign_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_scope text := coalesce(tg_argv[0], v_row ->> 'kind');
  v_prefix text;
  v_last integer;
  v_number integer;
  v_id text := v_row ->> 'ledger_id';
begin
  -- 남의 작업공간이면 번호표를 보기 전에 권한 오류로 멈춘다(RLS와 같은 결과, 번호 존재 여부를 알리지 않음).
  if current_user = 'authenticated' and not private.app_is_workspace_owner(new.workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_NOT_OWNER';
  end if;
  select c.prefix, c.last_number into v_prefix, v_last
  from public.app_ledger_id_counters c
  where c.workspace_id = new.workspace_id and c.scope = v_scope
  for update;
  if v_prefix is null then
    raise exception using errcode = '23514', message = 'LEDGER_ID_PREFIX_MISSING: no id prefix for ' || v_scope;
  end if;
  if v_id is null then
    v_number := v_last + 1;
    v_id := v_prefix || '-' || pg_catalog.lpad(v_number::text, greatest(4, pg_catalog.length(v_number::text)), '0');
    new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object('ledger_id', v_id));
  else
    if v_row ->> 'import_id' is null then
      raise exception using errcode = '23514', message = 'LEDGER_ID_ASSIGNED_BY_DB: only an import may carry an existing id';
    end if;
    if v_id !~ ('^' || v_prefix || '-[0-9]{4,6}$') then
      raise exception using errcode = '23514', message = 'LEDGER_ID_FORMAT: id must be ' || v_prefix || '-0000';
    end if;
    v_number := pg_catalog."substring"(v_id, '[0-9]+$')::integer;
    -- 같은 번호를 다른 모양(EVT-0912와 EVT-00912)으로 두 번 쓰지 못하게, 4자리 미만만 0으로 채운 모양만 받는다.
    if v_id <> v_prefix || '-' || pg_catalog.lpad(v_number::text, greatest(4, pg_catalog.length(v_number::text)), '0') then
      raise exception using errcode = '23514', message = 'LEDGER_ID_FORMAT: id must be ' || v_prefix || '-0000';
    end if;
  end if;
  if v_number > v_last then
    update public.app_ledger_id_counters c set last_number = v_number
    where c.workspace_id = new.workspace_id and c.scope = v_scope;
  end if;
  return new;
end
$$;

-- 번호표는 줄어들지 않는다.
create function private.app_ledger_counter_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.last_number < old.last_number then
    raise exception using errcode = '23514', message = 'LEDGER_ID_COUNTER_DECREASE: numbers are never reused';
  end if;
  return new;
end
$$;

-- 고친 때는 DB가 적는다. 같은 거래 안에서 고쳐도 만든 때와 달라지도록 실제 시각(clock_timestamp)을 쓴다
-- (되돌리기의 "고친 적 없는 행" 판단이 updated_at = created_at이기 때문).
create function private.app_ledger_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object('updated_at', pg_catalog.clock_timestamp()));
  return new;
end
$$;

-- 정해진 후보·가져오기 묶음은 고칠 수 없다(후보 대기 → 확정·버림, 묶음 적용 → 확인·되돌림 한 번만).
-- tg_argv[0] = 아직 열린 상태 값('pending' 또는 'applied').
create function private.app_ledger_decided_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.to_jsonb(old) ->> 'status' <> tg_argv[0] then
    raise exception using errcode = '23514', message = 'LEDGER_ALREADY_DECIDED: a decided row cannot change';
  end if;
  return new;
end
$$;

-- 고치기 전 값(바뀐 칸만)·지운 행 전체를 감사 기록에 남긴다. 후보 상태가 바뀌면 'candidate_decided'.
create function private.app_ledger_audit_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_event text := 'row_update';
begin
  if tg_op = 'DELETE' then
    insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, detail)
    values (old.workspace_id, 'row_delete', tg_argv[0], old.id, pg_catalog.jsonb_build_object('before', pg_catalog.to_jsonb(old)));
    return null;
  end if;
  select pg_catalog.jsonb_object_agg(o.key, o.value) into v_before
  from pg_catalog.jsonb_each(pg_catalog.to_jsonb(old)) o
  where o.key <> 'updated_at' and o.value is distinct from (pg_catalog.to_jsonb(new) -> o.key);
  if v_before is not null then
    if tg_argv[0] = 'candidates' and v_before ? 'status' then
      v_event := 'candidate_decided';
    end if;
    insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, detail)
    values (new.workspace_id, v_event, tg_argv[0], new.id, pg_catalog.jsonb_build_object('before', v_before));
  end if;
  return null;
end
$$;
revoke all on function private.app_ledger_assign_id(), private.app_ledger_counter_guard(), private.app_ledger_touch(),
  private.app_ledger_decided_guard(), private.app_ledger_audit_change() from public, anon, authenticated, service_role;

create trigger app_ledger_topics_assign_id before insert on public.app_ledger_topics
  for each row execute function private.app_ledger_assign_id('topic');
create trigger app_ledger_organizations_assign_id before insert on public.app_ledger_organizations
  for each row execute function private.app_ledger_assign_id('organization');
create trigger app_ledger_sources_assign_id before insert on public.app_ledger_sources
  for each row execute function private.app_ledger_assign_id('source');
create trigger app_ledger_records_assign_id before insert on public.app_ledger_records
  for each row execute function private.app_ledger_assign_id();
create trigger app_ledger_id_counters_guard before update on public.app_ledger_id_counters
  for each row execute function private.app_ledger_counter_guard();
create trigger app_ledger_topics_touch before update on public.app_ledger_topics
  for each row execute function private.app_ledger_touch();
create trigger app_ledger_organizations_touch before update on public.app_ledger_organizations
  for each row execute function private.app_ledger_touch();
create trigger app_ledger_sources_touch before update on public.app_ledger_sources
  for each row execute function private.app_ledger_touch();
create trigger app_ledger_records_touch before update on public.app_ledger_records
  for each row execute function private.app_ledger_touch();
create trigger app_ledger_candidates_guard before update on public.app_ledger_candidates
  for each row execute function private.app_ledger_decided_guard('pending');
create trigger app_ledger_imports_guard before update on public.app_ledger_imports
  for each row execute function private.app_ledger_decided_guard('applied');
create trigger app_ledger_topics_audit after update or delete on public.app_ledger_topics
  for each row execute function private.app_ledger_audit_change('topics');
create trigger app_ledger_organizations_audit after update or delete on public.app_ledger_organizations
  for each row execute function private.app_ledger_audit_change('organizations');
create trigger app_ledger_sources_audit after update or delete on public.app_ledger_sources
  for each row execute function private.app_ledger_audit_change('sources');
create trigger app_ledger_records_audit after update or delete on public.app_ledger_records
  for each row execute function private.app_ledger_audit_change('records');
create trigger app_ledger_record_sources_audit after update or delete on public.app_ledger_record_sources
  for each row execute function private.app_ledger_audit_change('record_sources');
create trigger app_ledger_links_audit after update or delete on public.app_ledger_links
  for each row execute function private.app_ledger_audit_change('links');
create trigger app_ledger_candidates_audit after update on public.app_ledger_candidates
  for each row execute function private.app_ledger_audit_change('candidates');

-- 권한: 호스팅 기본 권한을 모두 걷어 내고 authenticated에 필요한 동작·칸만.
-- ID·workspace·종류·가져오기 묶음·만든 때는 만든 뒤 못 바꾼다(UPDATE 칸 목록에 없음).
-- 원장 행(주제·조직·출처·기록) 삭제는 "아직 확인 안 한 가져오기 묶음에서 들어온, 고친 적 없는 행"만(되돌리기용, 제한 정책).
-- 그 밖에는 지우지 않고 대체·폐기 상태로 둔다. 연결 두 표는 잘못 붙인 연결을 뗄 수 있다(지운 행은 감사 기록에 남음).
alter table public.app_ledger_imports enable row level security;
alter table public.app_ledger_id_counters enable row level security;
alter table public.app_ledger_topics enable row level security;
alter table public.app_ledger_organizations enable row level security;
alter table public.app_ledger_sources enable row level security;
alter table public.app_ledger_records enable row level security;
alter table public.app_ledger_record_sources enable row level security;
alter table public.app_ledger_links enable row level security;
alter table public.app_ledger_candidates enable row level security;
alter table public.app_ledger_audit enable row level security;
revoke all on table public.app_ledger_imports, public.app_ledger_id_counters, public.app_ledger_topics,
  public.app_ledger_organizations, public.app_ledger_sources, public.app_ledger_records,
  public.app_ledger_record_sources, public.app_ledger_links, public.app_ledger_candidates, public.app_ledger_audit
  from public, anon, authenticated, service_role;
grant select on table public.app_ledger_imports, public.app_ledger_id_counters, public.app_ledger_topics,
  public.app_ledger_organizations, public.app_ledger_sources, public.app_ledger_records,
  public.app_ledger_record_sources, public.app_ledger_links, public.app_ledger_candidates, public.app_ledger_audit
  to authenticated;
grant insert (workspace_id, label, source_kind, file_sha256, row_counts) on table public.app_ledger_imports to authenticated;
grant update (status, decided_at) on table public.app_ledger_imports to authenticated;
grant insert (workspace_id, scope, prefix) on table public.app_ledger_id_counters to authenticated;
grant update (last_number) on table public.app_ledger_id_counters to authenticated;
grant insert (workspace_id, ledger_id, name, aliases, description, project_id, status, sort_order, import_id)
  on table public.app_ledger_topics to authenticated;
grant update (name, aliases, description, project_id, status, sort_order) on table public.app_ledger_topics to authenticated;
grant insert (workspace_id, ledger_id, name, aliases, suborganization_id, note, status, import_id)
  on table public.app_ledger_organizations to authenticated;
grant update (name, aliases, suborganization_id, note, status) on table public.app_ledger_organizations to authenticated;
grant insert (workspace_id, ledger_id, title, doc_type, location, drive_file_id, source_date, coverage,
  processing_status, sensitivity, note, status, import_id) on table public.app_ledger_sources to authenticated;
grant update (title, doc_type, location, drive_file_id, source_date, coverage, processing_status, sensitivity, note, status)
  on table public.app_ledger_sources to authenticated;
grant insert (workspace_id, kind, ledger_id, title, summary, scope, topic_id, sensitivity, importance, validity,
  confidence, verification, date_start, date_end, date_precision, date_note, event_status, decision_type,
  decision_reason, evidence_type, counterparty, commitment_status, follow_up_on, superseded_by, supersede_reason,
  note, import_id) on table public.app_ledger_records to authenticated;
grant update (title, summary, scope, topic_id, sensitivity, importance, validity, confidence, verification,
  date_start, date_end, date_precision, date_note, event_status, decision_type, decision_reason, evidence_type,
  counterparty, commitment_status, follow_up_on, superseded_by, supersede_reason, note)
  on table public.app_ledger_records to authenticated;
grant insert (workspace_id, record_id, source_id, locator, note, import_id) on table public.app_ledger_record_sources to authenticated;
grant update (locator, note) on table public.app_ledger_record_sources to authenticated;
grant delete on table public.app_ledger_record_sources to authenticated;
grant insert (workspace_id, record_id, target_record_id, target_organization_id, target_project_id, target_meeting_id,
  relation, note, import_id) on table public.app_ledger_links to authenticated;
grant update (relation, note) on table public.app_ledger_links to authenticated;
grant delete on table public.app_ledger_links to authenticated;
grant insert (workspace_id, origin, action, kind, target_record_id, title, payload, sensitivity, dedup_key, import_id)
  on table public.app_ledger_candidates to authenticated;
grant update (status, title, payload, sensitivity, result_record_id, discard_reason, decided_at)
  on table public.app_ledger_candidates to authenticated;
grant insert (workspace_id, event, target_table, target_id, legacy_id, import_id, occurred_at, detail)
  on table public.app_ledger_audit to authenticated;
grant delete on table public.app_ledger_topics, public.app_ledger_organizations, public.app_ledger_sources,
  public.app_ledger_records, public.app_ledger_audit to authenticated;

-- 정책: 표마다 owner 하나. 원장 표끼리의 참조는 (workspace_id, id) 묶음 외래 키라 없는 행·남의 작업공간 행을 가리키면
-- DB가 거절한다(23503). Web2 프로젝트·회의는 기존 같은-작업공간 확인 함수, 담당조직은 owner가 읽을 수 있는 행만.
create policy ledger_imports_owner_all on public.app_ledger_imports for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_id_counters_owner_all on public.app_ledger_id_counters for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_topics_owner_all on public.app_ledger_topics for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id) and private.app_space_in_workspace(project_id, workspace_id));
create policy ledger_organizations_owner_all on public.app_ledger_organizations for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (suborganization_id is null or exists (select 1 from public.app_suborganizations o
      where o.id = suborganization_id and o.workspace_id = app_ledger_organizations.workspace_id)));
create policy ledger_sources_owner_all on public.app_ledger_sources for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_records_owner_all on public.app_ledger_records for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_record_sources_owner_all on public.app_ledger_record_sources for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_links_owner_all on public.app_ledger_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and private.app_space_in_workspace(target_project_id, workspace_id)
    and private.app_meeting_in_workspace(target_meeting_id, workspace_id));
create policy ledger_candidates_owner_all on public.app_ledger_candidates for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_audit_owner_read on public.app_ledger_audit for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy ledger_audit_owner_insert on public.app_ledger_audit for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id));
-- 감사 기록은 옛 쓰기요청 행만, 아직 확인 안 한 가져오기 묶음을 되돌릴 때만 지운다.
create policy ledger_audit_owner_revert on public.app_ledger_audit for delete to authenticated
  using (
    private.app_is_workspace_owner(workspace_id)
    and event = 'legacy_write_request'
    and exists (select 1 from public.app_ledger_imports i where i.id = import_id and i.status = 'applied'));
-- 제한 정책(AND로 걸림): 원장 행은 확인 전 가져오기 묶음에서 들어와 고친 적 없는 것만 지운다.
create policy ledger_topics_revert_only on public.app_ledger_topics as restrictive for delete to authenticated
  using (updated_at = created_at and exists (select 1 from public.app_ledger_imports i
    where i.id = import_id and i.status = 'applied'));
create policy ledger_organizations_revert_only on public.app_ledger_organizations as restrictive for delete to authenticated
  using (updated_at = created_at and exists (select 1 from public.app_ledger_imports i
    where i.id = import_id and i.status = 'applied'));
create policy ledger_sources_revert_only on public.app_ledger_sources as restrictive for delete to authenticated
  using (updated_at = created_at and exists (select 1 from public.app_ledger_imports i
    where i.id = import_id and i.status = 'applied'));
create policy ledger_records_revert_only on public.app_ledger_records as restrictive for delete to authenticated
  using (updated_at = created_at and exists (select 1 from public.app_ledger_imports i
    where i.id = import_id and i.status = 'applied'));

-- 검색: 글자 일치(띄어 쓴 낱말 모두 포함, 최대 6개) + 종류·조직·주제·기간·민감도·범위 필터. 소유자만(RLS 그대로).
-- 찾는 곳: ID·제목·요약·비고·결정이유·상대측·날짜표기, 주제 이름·별칭, 연결된 조직 이름·별칭, 연결된 출처 ID·제목.
-- 조직 필터는 원장 조직 ID와 Web2 담당조직 ID 둘 다 받는다. 대체·폐기 기록은 p_include_inactive일 때만.
create function public.app_ledger_search(
  p_query text default '',
  p_kinds text[] default null,
  p_organization_id uuid default null,
  p_topic_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_max_sensitivity text default 'S2',
  p_scope text default 'work',
  p_include_inactive boolean default false,
  p_limit integer default 50)
returns table (
  id uuid, ledger_id text, kind text, title text, summary text, date_start date, date_end date,
  date_precision text, validity text, sensitivity text, topic_name text, organizations text[], score integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_words text[];
begin
  p_query := coalesce(p_query, '');
  if pg_catalog.char_length(p_query) > 200 or p_query ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_QUERY';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_LIMIT';
  end if;
  if p_max_sensitivity is null or p_max_sensitivity not in ('S0', 'S1', 'S2') then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_SENSITIVITY';
  end if;
  if p_scope is not null and p_scope not in ('work', 'interest') then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_SCOPE';
  end if;
  if p_kinds is not null and (pg_catalog.cardinality(p_kinds) = 0
      or not p_kinds <@ array['event', 'change', 'decision', 'evidence', 'commitment']) then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_KIND';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception using errcode = '22023', message = 'LEDGER_SEARCH_BAD_PERIOD';
  end if;
  select coalesce(pg_catalog.array_agg(w), '{}') into v_words
  from (select distinct w from pg_catalog.unnest(pg_catalog.regexp_split_to_array(pg_catalog.lower(pg_catalog.btrim(p_query)), '\s+')) w
        where w <> '' limit 6) x;

  return query
  with base as (
    select r.id, r.ledger_id, r.kind, r.title, r.summary, r.date_start, r.date_end, r.date_precision, r.validity,
      r.sensitivity, t.name as topic_name,
      (select pg_catalog.array_agg(o.name order by o.name) from public.app_ledger_links l
         join public.app_ledger_organizations o on o.id = l.target_organization_id where l.record_id = r.id) as organizations,
      pg_catalog.lower(r.title) as title_l,
      pg_catalog.lower(pg_catalog.concat_ws(' ', r.ledger_id, r.title, r.summary, r.note, r.decision_reason, r.counterparty,
        r.date_note, t.ledger_id, t.name, pg_catalog.array_to_string(t.aliases, ' '),
        (select pg_catalog.string_agg(pg_catalog.concat_ws(' ', o.ledger_id, o.name, pg_catalog.array_to_string(o.aliases, ' ')), ' ')
           from public.app_ledger_links l join public.app_ledger_organizations o on o.id = l.target_organization_id
           where l.record_id = r.id),
        (select pg_catalog.string_agg(pg_catalog.concat_ws(' ', s.ledger_id, s.title), ' ')
           from public.app_ledger_record_sources rs join public.app_ledger_sources s on s.id = rs.source_id
           where rs.record_id = r.id))) as hay
    from public.app_ledger_records r
    left join public.app_ledger_topics t on t.id = r.topic_id
    where (p_kinds is null or r.kind = any (p_kinds))
      and r.sensitivity <= p_max_sensitivity
      and (p_scope is null or r.scope = p_scope)
      and (p_include_inactive or r.validity not in ('superseded', 'retired'))
      and (p_topic_id is null or r.topic_id = p_topic_id)
      and (p_date_from is null or coalesce(r.date_end, r.date_start) >= p_date_from)
      and (p_date_to is null or r.date_start <= p_date_to)
      and (p_organization_id is null or exists (
        select 1 from public.app_ledger_links l join public.app_ledger_organizations o on o.id = l.target_organization_id
        where l.record_id = r.id and (o.id = p_organization_id or o.suborganization_id = p_organization_id)))
  )
  select b.id, b.ledger_id, b.kind, b.title, pg_catalog.left(b.summary, 300), b.date_start, b.date_end, b.date_precision,
    b.validity, b.sensitivity, b.topic_name, coalesce(b.organizations, '{}'),
    (select pg_catalog.count(*) from pg_catalog.unnest(v_words) w where pg_catalog.strpos(b.title_l, w) > 0)::integer
      + (case when pg_catalog.lower(b.ledger_id) = any (v_words) then 10 else 0 end)
  from base b
  where (select pg_catalog.bool_and(pg_catalog.strpos(b.hay, w) > 0) from pg_catalog.unnest(v_words) w) is not false
  order by 13 desc, b.date_start desc nulls last, b.ledger_id
  limit p_limit;
end
$$;
revoke all on function public.app_ledger_search(text, text[], uuid, uuid, date, date, text, text, boolean, integer)
  from public, anon, service_role;
grant execute on function public.app_ledger_search(text, text[], uuid, uuid, date, date, text, text, boolean, integer)
  to authenticated;

-- 사후 확인: 표 10개 RLS 켬, owner 정책만(authenticated), anon·PUBLIC·service_role 권한 없음, 함수 모두 INVOKER.
do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'app\_ledger\_%'
        and relkind = 'r' and relrowsecurity) <> 10
     or exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'app\_ledger\_%'
        and relkind = 'r' and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace and c.relname like 'app\_ledger\_%' and c.relkind = 'r'
          and a.attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace and c.relname like 'app\_ledger\_%'
          and (p.polroles <> array['authenticated'::regrole]::oid[]
            or (p.polpermissive and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
                  not like '%app_is_workspace_owner(workspace_id)%')
            or (not p.polpermissive and p.polcmd <> 'd')))
     or (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace and c.relname like 'app\_ledger\_%' and p.polpermissive) <> 12
     or (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace and c.relname like 'app\_ledger\_%' and not p.polpermissive) <> 4
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname like 'app\_ledger\_%'
          and (p.prosecdef or p.proconfig is distinct from array['search_path=""']))
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname like 'app\_ledger\_%') <> 6 then
    raise exception 'LEDGER_SCHEMA_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021082000', 'ledger_schema', array['S7-a: app_ledger_* 10 tables (owner RLS, no anon/service_role, ledger rows deletable only by unconfirmed import revert), id counters, audit triggers, app_ledger_search']);
commit;
