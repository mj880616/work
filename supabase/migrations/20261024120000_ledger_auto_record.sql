begin;
-- LEDGER-자동기록 DB (docs/design/ledger-auto-record.md 4절, 명진 결정 2026-10-24 07:43~07:45). 앱·Edge 코드 변경 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 무엇:
--   1) 새 표 4개(모두 RLS 켜짐, 정책은 표마다 owner 하나 = private.app_is_workspace_owner, authenticated만, PUBLIC·anon·service_role 권한 없음):
--      app_ledger_auto_runs        자동 기록 한 번 = 한 행(하루 횟수·한 번에 하나만(잠금)·되돌리기 단위). 글 없음, 숫자·상태만.
--      app_ledger_auto_sources     원문별 처리 표: 어떤 Web2 기록(업데이트·사업 보고·담당조직 기록·노트·업무일지 한 줄·프로젝트 기록)을 언제 봤나. 지우지 않음.
--      app_ledger_fix_requests     원장 수정 요청 한 건 = 한 행(반영한 것만). 요청 글(64KB 이하)과 결과. 지우지 않음.
--      app_ledger_record_changes   쌓기만 하는 변경 기록: 어떤 기록이 어느 자동 실행·수정 요청으로 생겼나/대체됐나/폐기됐나/확인필요가 됐나,
--                                  기존 기록에 더한 근거 줄(되돌리기용). 설계 4.1의 "기록 표 칸 추가"(entry_route·auto_run_id·fix_request_id·change_note)를 대신한다:
--                                  확장 규칙이 "이번 파일에서 만들지 않은 기존 표에 권한 추가"(grant-existing)를 거절해 기존 기록 표에 칸을 더할 수 없고,
--                                  기존 표의 권한·정책·트리거는 건드리지 않는 쪽이 안전하기 때문이다. 기록 상세는 이 표를 record_id로 붙여 읽는다.
--   2) 기존 감사 기록 표(app_ledger_audit)의 target_table 값 목록 CHECK에 auto_runs·fix_requests 두 값만 더한다(권한·정책 아님, 값 목록만 넓힘).
--   3) 함수 5개(public, SECURITY INVOKER, search_path 빈칸, authenticated만 실행) + 도우미 4개(private, 같은 방식):
--      app_auto_ledger_begin   실행 하나 시작(2분 넘은 running은 실패로 정리, 이미 돌고 있거나 하루 16회면 거절)
--      app_auto_ledger_record  한 거래로: 새 기록 / 기존 사건에 변화로 이어 붙이기 / 기존 기록에 근거 추가 / 원문 바뀐 기록 '확인필요' 표시
--                              + 원문별 처리 표 갱신 + 실행 done. 틀리면 전부 취소하고 실행만 failed로 남김(처리 표는 그대로).
--      app_auto_ledger_undo    실행 하나 되돌리기(만든 기록 폐기, 다른 기록에 더한 근거 줄 떼기, 확인필요 복원). 그 뒤 고쳐졌으면 거절.
--      app_apply_ledger_fix    원장 수정 요청 반영(replace 고쳐 바꾸기 / retire 폐기 / add_source 근거 추가). 해 보기는 전·후만 돌려주고 남기지 않음.
--      app_undo_ledger_fix     반영 직후 실수 되돌리기. 그 뒤 고쳐졌으면 거절.
--   서버 AI(ai-assist)는 명진 로그인 토큰으로 이 함수를 부른다. service_role을 쓰지 않는다(service_role 권한을 만들지 않음).
-- 더하기만: 자동 기록 함수가 하는 일은 새 기록·근거 줄·연결 줄을 더하는 것뿐이고, 기존 기록에 하는 변경은 '확인필요' 표시 하나(validity current → needs_check)다.
--   내용 칸은 고치지 않고 지우지 않는다(원장 기록 지우기는 기존 제한 정책이 그대로 막는다). 고치기는 수정 요청 함수만: 옛 기록은 superseded('대체됨'), 새 기록이 이어받는다.
-- 권한: 기존 표·정책·권한·트리거·함수는 바꾸지 않는다(감사 CHECK 값 목록 하나만 예외). 새 표 정책은 모두 `to authenticated`. SECURITY DEFINER 없음.
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 자동 실행·수정 요청·변경 기록·처리 표 행이 하나라도 있으면 멈춘다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024120000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021082000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021190000')
     or to_regclass('public.app_ledger_records') is null
     or to_regclass('public.app_ledger_sources') is null
     or to_regclass('public.app_ledger_record_sources') is null
     or to_regclass('public.app_ledger_links') is null
     or to_regclass('public.app_ledger_audit') is null
     or to_regclass('public.app_ledger_candidates') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_ledger_auto_runs') is not null
     or to_regclass('public.app_ledger_auto_sources') is not null
     or to_regclass('public.app_ledger_fix_requests') is not null
     or to_regclass('public.app_ledger_record_changes') is not null
     or to_regprocedure('public.app_auto_ledger_begin(uuid)') is not null
     or to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') is not null
     or to_regprocedure('public.app_auto_ledger_undo(uuid)') is not null
     or to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)') is not null
     or to_regprocedure('public.app_undo_ledger_fix(uuid)') is not null
     or to_regprocedure('private.app_auto_ledger_personal(text)') is not null
     or to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') is not null
     or to_regprocedure('private.app_auto_ledger_insert(uuid,text,text,text,jsonb)') is not null
     or to_regprocedure('private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     -- 기록 표: RLS 켜짐, anon·PUBLIC 표 권한 없음, 소유자 정책 그대로, 대체 CHECK 그대로.
     or exists (select 1 from pg_class where oid = 'public.app_ledger_records'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_ledger_records'::regclass and polname = 'ledger_records_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or not exists (select 1 from pg_constraint where conrelid = 'public.app_ledger_records'::regclass
         and conname = 'app_ledger_records_supersede_check' and contype = 'c')
     -- 감사 표: 값 목록 CHECK가 예상한 옛 모양(auto_runs·fix_requests 없음, imports 있음).
     or not exists (select 1 from pg_constraint where conrelid = 'public.app_ledger_audit'::regclass
         and conname = 'app_ledger_audit_target_check' and contype = 'c'
         and pg_get_constraintdef(oid) like '%imports%' and pg_get_constraintdef(oid) not like '%auto_runs%') then
    raise exception 'LEDGER_AUTO_RECORD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 자동 기록 실행. 숫자·상태·시각만(글 없음). 같은 작업공간에 running은 하나뿐(부분 유일 색인) = 한 번에 하나만 돈다.
create table public.app_ledger_auto_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_seen integer not null default 0,
  records_new integer not null default 0,
  changes_linked integer not null default 0,
  sources_added integer not null default 0,
  needs_check integer not null default 0,
  skipped integer not null default 0,
  excluded integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  fail_code text,
  undone_at timestamptz,
  constraint app_ledger_auto_runs_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_auto_runs_status_check check (
    status in ('running', 'done', 'failed', 'undone')
    and (status = 'running') = (finished_at is null)
    and (status = 'failed') = (fail_code is not null)
    and (status = 'undone') = (undone_at is not null)),
  constraint app_ledger_auto_runs_counts_check check (
    sources_seen between 0 and 100000 and records_new between 0 and 100000 and changes_linked between 0 and 100000
    and sources_added between 0 and 100000 and needs_check between 0 and 100000 and skipped between 0 and 100000
    and excluded between 0 and 100000 and tokens_in between 0 and 100000000 and tokens_out between 0 and 100000000),
  constraint app_ledger_auto_runs_fail_code_check check (fail_code is null or fail_code ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
create unique index app_ledger_auto_runs_one_running on public.app_ledger_auto_runs(workspace_id) where status = 'running';
create index app_ledger_auto_runs_list_idx on public.app_ledger_auto_runs(workspace_id, started_at desc);

-- 2) 원문별 처리 표: (작업공간, 종류, 원문 ID)마다 한 행. 본 때의 updated_at과 마지막 실행.
create table public.app_ledger_auto_sources (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_kind text not null,
  source_id uuid not null,
  seen_updated_at timestamptz not null,
  last_run_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (workspace_id, source_kind, source_id),
  constraint app_ledger_auto_sources_run_fk foreign key (workspace_id, last_run_id) references public.app_ledger_auto_runs(workspace_id, id),
  constraint app_ledger_auto_sources_kind_check check (source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update'))
);
create index app_ledger_auto_sources_run_idx on public.app_ledger_auto_sources(last_run_id);

-- 3) 원장 수정 요청: 반영한 것만 한 행. 요청 글은 믿지 않는 입력이라 함수가 모양을 검사한 뒤에만 들어온다.
create table public.app_ledger_fix_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  received_from text not null default 'claude_chat',
  request jsonb not null,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'applied',
  applied_at timestamptz not null default now(),
  undone_at timestamptz,
  constraint app_ledger_fix_requests_workspace_row_key unique (workspace_id, id),
  constraint app_ledger_fix_requests_from_check check (received_from in ('claude_chat', 'user')),
  constraint app_ledger_fix_requests_request_check check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 65536),
  constraint app_ledger_fix_requests_result_check check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 16384),
  constraint app_ledger_fix_requests_status_check check (status in ('applied', 'undone') and (status = 'undone') = (undone_at is not null))
);
create index app_ledger_fix_requests_list_idx on public.app_ledger_fix_requests(workspace_id, applied_at desc);

-- 4) 변경 기록(쌓기만): 기록마다 어떻게 생겼고 어떻게 바뀌었나. route auto = 자동 기록 실행, correction = 수정 요청.
--    action: created(새 기록, 자동·수정 요청이 만듦) / source_added(기존 기록에 근거 줄 추가) / needs_check(자동이 확인필요로 표시)
--            replaced(수정 요청이 옛 기록을 대체됨으로) / retired(폐기: 수정 요청 retire·실행 취소·반영 취소로 새 기록 폐기)
--    line_table·line_id: source_added가 만든 근거 줄(되돌리기 때 정확히 그 줄만 뗌). dedup_key: 자동이 만든 기록의 열쇠(같은 열쇠는 한 번만).
create table public.app_ledger_record_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  record_id uuid not null,
  action text not null,
  route text not null,
  run_id uuid,
  fix_request_id uuid,
  line_table text,
  line_id uuid,
  note text not null default '',
  detail jsonb not null default '{}'::jsonb,
  dedup_key text,
  created_at timestamptz not null default now(),
  constraint app_ledger_record_changes_record_fk foreign key (workspace_id, record_id) references public.app_ledger_records(workspace_id, id),
  constraint app_ledger_record_changes_run_fk foreign key (workspace_id, run_id) references public.app_ledger_auto_runs(workspace_id, id),
  constraint app_ledger_record_changes_fix_fk foreign key (workspace_id, fix_request_id) references public.app_ledger_fix_requests(workspace_id, id),
  constraint app_ledger_record_changes_action_check check (action in ('created', 'source_added', 'needs_check', 'replaced', 'retired')),
  constraint app_ledger_record_changes_route_check check (
    (route = 'auto' and run_id is not null and fix_request_id is null)
    or (route = 'correction' and fix_request_id is not null and run_id is null)),
  constraint app_ledger_record_changes_line_check check (
    (line_table is null) = (line_id is null) and (line_table is null or line_table in ('record_sources', 'links'))),
  constraint app_ledger_record_changes_note_check check (char_length(note) <= 300 and note !~ '[[:cntrl:]]'),
  constraint app_ledger_record_changes_detail_check check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
  constraint app_ledger_record_changes_dedup_check check (
    dedup_key is null or (action = 'created' and route = 'auto' and char_length(dedup_key) between 1 and 300 and dedup_key !~ '[[:cntrl:]]'))
);
create unique index app_ledger_record_changes_dedup_key on public.app_ledger_record_changes(workspace_id, dedup_key) where dedup_key is not null;
create index app_ledger_record_changes_record_idx on public.app_ledger_record_changes(record_id, created_at desc);
create index app_ledger_record_changes_run_idx on public.app_ledger_record_changes(run_id) where run_id is not null;
create index app_ledger_record_changes_fix_idx on public.app_ledger_record_changes(fix_request_id) where fix_request_id is not null;

-- 권한: 호스팅 기본 권한을 모두 걷어 내고 authenticated에 필요한 동작·칸만. 변경 기록은 읽기·더하기만(고치기·지우기 권한 없음).
alter table public.app_ledger_auto_runs enable row level security;
alter table public.app_ledger_auto_sources enable row level security;
alter table public.app_ledger_fix_requests enable row level security;
alter table public.app_ledger_record_changes enable row level security;
revoke all on table public.app_ledger_auto_runs, public.app_ledger_auto_sources, public.app_ledger_fix_requests,
  public.app_ledger_record_changes from public, anon, authenticated, service_role;
grant select on table public.app_ledger_auto_runs, public.app_ledger_auto_sources, public.app_ledger_fix_requests,
  public.app_ledger_record_changes to authenticated;
grant insert (workspace_id) on table public.app_ledger_auto_runs to authenticated;
grant update (status, finished_at, sources_seen, records_new, changes_linked, sources_added, needs_check, skipped, excluded,
  tokens_in, tokens_out, fail_code, undone_at) on table public.app_ledger_auto_runs to authenticated;
grant insert (workspace_id, source_kind, source_id, seen_updated_at, last_run_id) on table public.app_ledger_auto_sources to authenticated;
grant update (seen_updated_at, last_run_id, seen_at) on table public.app_ledger_auto_sources to authenticated;
grant insert (workspace_id, received_from, request, result) on table public.app_ledger_fix_requests to authenticated;
grant update (result, status, undone_at) on table public.app_ledger_fix_requests to authenticated;
grant insert (workspace_id, record_id, action, route, run_id, fix_request_id, line_table, line_id, note, detail, dedup_key)
  on table public.app_ledger_record_changes to authenticated;

create policy ledger_auto_runs_owner_all on public.app_ledger_auto_runs for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_auto_sources_owner_all on public.app_ledger_auto_sources for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_fix_requests_owner_all on public.app_ledger_fix_requests for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy ledger_record_changes_owner_all on public.app_ledger_record_changes for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 감사 기록의 대상 표 목록에 두 값만 더한다(옛 값은 그대로, 권한·정책 변경 아님).
alter table public.app_ledger_audit drop constraint app_ledger_audit_target_check,
  add constraint app_ledger_audit_target_check check (
    (target_table is null) = (target_id is null)
    and (target_table is null or target_table in (
      'records', 'sources', 'organizations', 'topics', 'record_sources', 'links', 'candidates', 'imports',
      'auto_runs', 'fix_requests')));

-- 도우미 1: 개인정보 모양(주민번호·휴대전화). ledger-candidates.ts의 looksPersonal과 같은 모양.
create function private.app_auto_ledger_personal(p_text text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_text ~ '(^|[^0-9])[0-9]{6}[[:space:]]?-[[:space:]]?[1-4][0-9]{6}([^0-9]|$)'
    or p_text ~ '(^|[^0-9])01[016789][-. [:space:]]?[0-9]{3,4}[-. [:space:]]?[0-9]{4}([^0-9]|$)', false)
$$;

-- 도우미 2: 출처 하나를 정한다. {ledger_id: 'SRC-0000'} 이미 있는 출처, 또는 Web2 원문 {kind, id, title, doc_type, source_date, sensitivity, note}.
-- Web2 원문은 위치 web2:<종류>:<id>가 같은 출처를 다시 쓴다(한 원문에서 여러 기록 = 출처 하나).
create function private.app_auto_ledger_source(p_workspace_id uuid, p_spec jsonb)
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

-- 도우미 3: 기록 하나 만들기(고정 ID는 번호표 트리거가 붙인다). 내용 모양: 기존 후보 확정 함수의 record와 같은 칸.
-- 반환 {id, ledger_id}.
create function private.app_auto_ledger_insert(p_workspace_id uuid, p_kind text, p_title text, p_sensitivity text, p_rec jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_topic uuid;
  v_id uuid;
  v_ledger text;
begin
  if p_kind is null or p_kind not in ('event', 'change', 'decision', 'evidence', 'commitment')
     or p_sensitivity is null or p_sensitivity not in ('S0', 'S1', 'S2')
     or coalesce(pg_catalog.btrim(p_title), '') = ''
     or p_rec is null or pg_catalog.jsonb_typeof(p_rec) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_rec) k where k not in (
       'summary', 'scope', 'topic', 'topic_id', 'importance', 'validity', 'confidence', 'verification', 'date_start', 'date_end',
       'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
       'commitment_status', 'follow_up_on', 'note'))
     or coalesce(p_rec ->> 'validity', 'current') not in ('current', 'needs_check', 'fulfilled') then
    raise exception using errcode = '22023', message = 'LEDGER_AUTO_BAD_ITEM: record';
  end if;
  if private.app_auto_ledger_personal(pg_catalog.concat_ws(' ', p_title, p_rec ->> 'summary', p_rec ->> 'decision_reason',
       p_rec ->> 'counterparty', p_rec ->> 'note', p_rec ->> 'date_note')) then
    raise exception using errcode = '22023', message = 'LEDGER_AUTO_PERSONAL: record';
  end if;
  if (p_rec ->> 'topic') is not null then
    select t.id into v_topic from public.app_ledger_topics t
      where t.workspace_id = p_workspace_id and t.ledger_id = (p_rec ->> 'topic');
    if v_topic is null then
      raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: topic ' || (p_rec ->> 'topic');
    end if;
  elsif (p_rec ->> 'topic_id') is not null then
    select t.id into v_topic from public.app_ledger_topics t
      where t.workspace_id = p_workspace_id and t.id = (p_rec ->> 'topic_id')::uuid;
    if v_topic is null then
      raise exception using errcode = '23503', message = 'LEDGER_AUTO_BROKEN_REF: topic';
    end if;
  end if;
  insert into public.app_ledger_records (workspace_id, kind, title, summary, scope, topic_id, sensitivity, importance, validity,
    confidence, verification, date_start, date_end, date_precision, date_note, event_status, decision_type, decision_reason,
    evidence_type, counterparty, commitment_status, follow_up_on, note)
  values (p_workspace_id, p_kind, p_title, coalesce(p_rec ->> 'summary', ''), coalesce(p_rec ->> 'scope', 'work'), v_topic,
    p_sensitivity, coalesce(p_rec ->> 'importance', 'normal'), coalesce(p_rec ->> 'validity', 'current'),
    p_rec ->> 'confidence', p_rec ->> 'verification', (p_rec ->> 'date_start')::date, (p_rec ->> 'date_end')::date,
    coalesce(p_rec ->> 'date_precision', case when (p_rec ->> 'date_start') is null then 'unknown' else 'day' end),
    coalesce(p_rec ->> 'date_note', ''),
    case when p_kind = 'event' then coalesce(p_rec ->> 'event_status', 'tracking') else p_rec ->> 'event_status' end,
    p_rec ->> 'decision_type', p_rec ->> 'decision_reason', p_rec ->> 'evidence_type', p_rec ->> 'counterparty',
    case when p_kind = 'commitment' then coalesce(p_rec ->> 'commitment_status', 'waiting') else p_rec ->> 'commitment_status' end,
    (p_rec ->> 'follow_up_on')::date, coalesce(p_rec ->> 'note', ''))
  returning id, ledger_id into v_id, v_ledger;
  return pg_catalog.jsonb_build_object('id', v_id, 'ledger_id', v_ledger);
end
$$;

-- 도우미 4: 변경 기록 한 줄 쌓기. route는 실행이면 auto, 수정 요청이면 correction(표 CHECK가 짝을 검사한다).
create function private.app_auto_ledger_log(p_workspace_id uuid, p_record_id uuid, p_action text, p_route text, p_run_id uuid,
  p_fix_request_id uuid, p_line_table text, p_line_id uuid, p_note text, p_detail jsonb, p_dedup_key text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into public.app_ledger_record_changes (workspace_id, record_id, action, route, run_id, fix_request_id, line_table, line_id,
    note, detail, dedup_key)
  values (p_workspace_id, p_record_id, p_action, p_route, p_run_id, p_fix_request_id, p_line_table, p_line_id,
    coalesce(p_note, ''), coalesce(p_detail, '{}'::jsonb), p_dedup_key);
end
$$;

-- 자동 기록 시작. 반환 {run_id, started_at, first_run, last_done_at}.
-- 2분 넘은 running은 실패(LEDGER_AUTO_STALE)로 정리한다. 같은 작업공간에 running이 있으면 LEDGER_AUTO_BUSY, 오늘(한국 날짜) 16번째를 넘으면
-- LEDGER_AUTO_DAILY_LIMIT. AI를 부르지 않고 실패한 실행(토큰 0)은 하루 횟수에 세지 않는다.
create function public.app_auto_ledger_begin(p_workspace_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day_start timestamptz := ((pg_catalog.now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
  v_runs integer;
  v_run uuid;
  v_last timestamptz;
  v_any boolean;
begin
  if p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_AUTO_NOT_OWNER';
  end if;
  update public.app_ledger_auto_runs
    set status = 'failed', finished_at = pg_catalog.now(), fail_code = 'LEDGER_AUTO_STALE'
    where workspace_id = p_workspace_id and status = 'running' and started_at < pg_catalog.now() - interval '2 minutes';
  select pg_catalog.count(*) into v_runs from public.app_ledger_auto_runs r
    where r.workspace_id = p_workspace_id and r.started_at >= v_day_start
      and not (r.status = 'failed' and r.tokens_in = 0 and r.tokens_out = 0);
  if v_runs >= 16 then
    raise exception using errcode = '54000', message = 'LEDGER_AUTO_DAILY_LIMIT';
  end if;
  begin
    insert into public.app_ledger_auto_runs (workspace_id) values (p_workspace_id) returning id into v_run;
  exception
    when unique_violation then
      raise exception using errcode = '55006', message = 'LEDGER_AUTO_BUSY';
  end;
  select pg_catalog.max(r.finished_at) filter (where r.status = 'done'), pg_catalog.bool_or(r.status in ('done', 'undone'))
    into v_last, v_any from public.app_ledger_auto_runs r where r.workspace_id = p_workspace_id and r.id <> v_run;
  return pg_catalog.jsonb_build_object('run_id', v_run, 'started_at', pg_catalog.now(), 'first_run', not coalesce(v_any, false),
    'last_done_at', v_last);
end
$$;

-- 자동 기록 넣기(한 거래). 묶음 모양:
--   { sources: [{kind, id, updated_at}],            이번에 본 Web2 원문(처리 표에 기록됨). 항목의 source는 여기 있는 것이어야 한다.
--     items: [ {op:'new', kind: event|change|decision|commitment, title, sensitivity: S0~S2, dedup_key, record:{...}, source:{...},
--               locator, belongs_to: 기존 사건 ID | belongs_to_item: 앞 항목 번호(1부터), links:[{target_organization|target_project_id|target_meeting_id, relation, note}]},
--              {op:'add_source', target: 기록 ID, source:{...}, locator} ],
--     needs_check: [{record: 기록 ID}],               원문이 바뀌어 이미 뽑은 내용이 틀려진 기록(현재유효만 '확인필요'로)
--     excluded, tokens_in, tokens_out }
-- 기존 기록의 내용은 고치지 않는다. 하나라도 틀리면 거래 전체를 취소하고 실행만 failed(오류 코드)로 남긴다 → {ok:false, error}.
-- 번호표에 그 종류 접두어가 없으면 LEDGER_ID_PREFIX_MISSING(기존 번호표 트리거)로 실패하고 처리 표는 그대로다.
create function public.app_auto_ledger_record(p_run_id uuid, p_batch jsonb)
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

-- 자동 기록 실행 되돌리기. 반환 {run_id, status: undone, records_retired, sources_unlinked, needs_check_restored}.
-- 그 실행이 만든 기록은 폐기(retired, 지우지 않음), 다른 기록에 더한 근거 줄은 뗀다, 확인필요로 바꾼 기록은 되돌린다.
-- 거절(아무것도 안 바뀜): 만든 기록이 그 뒤 고쳐졌거나, 다른 기록·수정 요청·후보가 가리키거나, 더한 줄·표시한 기록이 그 뒤 바뀌었을 때.
-- 처리 표와 열쇠는 그대로 둔다(같은 원문을 다시 뽑지 않음).
create function public.app_auto_ledger_undo(p_run_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  r public.app_ledger_auto_runs%rowtype;
  v_created uuid[];
  v_lines uuid[];
  v_flagged uuid[];
  v_retired integer := 0;
  v_unlinked integer := 0;
  v_restored integer := 0;
  v_n integer;
  v_today text := pg_catalog.to_char((pg_catalog.now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  v_id uuid;
begin
  select * into r from public.app_ledger_auto_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEDGER_AUTO_UNDO_NOT_FOUND';
  end if;
  if not private.app_is_workspace_owner(r.workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_AUTO_NOT_OWNER';
  end if;
  if r.status <> 'done' then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_UNDO_NOT_DONE: only a finished run can be undone';
  end if;
  select coalesce(pg_catalog.array_agg(c.record_id), '{}') into v_created from public.app_ledger_record_changes c
    where c.workspace_id = r.workspace_id and c.run_id = r.id and c.action = 'created';
  select coalesce(pg_catalog.array_agg(c.line_id), '{}') into v_lines from public.app_ledger_record_changes c
    where c.workspace_id = r.workspace_id and c.run_id = r.id and c.action = 'source_added';
  select coalesce(pg_catalog.array_agg(c.record_id), '{}') into v_flagged from public.app_ledger_record_changes c
    where c.workspace_id = r.workspace_id and c.run_id = r.id and c.action = 'needs_check';

  if exists (select 1 from public.app_ledger_records x where x.id = any (v_created) and x.updated_at <> x.created_at) then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_UNDO_CHANGED: a record of this run was edited afterwards';
  end if;
  if exists (select 1 from public.app_ledger_links l where l.target_record_id = any (v_created) and l.record_id <> all (v_created))
     or exists (select 1 from public.app_ledger_records x where x.superseded_by = any (v_created))
     or exists (select 1 from public.app_ledger_record_changes c where c.record_id = any (v_created) and c.run_id is distinct from r.id)
     or exists (select 1 from public.app_ledger_candidates x where x.workspace_id = r.workspace_id
         and (x.target_record_id = any (v_created) or x.result_record_id = any (v_created))) then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_UNDO_REFERENCED: another record, request or candidate points to a record of this run';
  end if;
  -- 이 실행 뒤에 근거 줄·표시한 기록이 고쳐졌거나 지워졌으면 거절(같은 거래에서 남은 감사 기록은 created_at이 실행 끝과 같아 제외).
  if exists (select 1 from public.app_ledger_audit a
       where a.workspace_id = r.workspace_id and a.created_at > r.finished_at
         and ((a.target_table = 'record_sources' and a.target_id = any (v_lines))
           or (a.target_table = 'records' and a.target_id = any (v_flagged)))) then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_UNDO_CHANGED: a line or record of this run was edited afterwards';
  end if;
  if exists (select 1 from public.app_ledger_record_changes c where c.record_id = any (v_flagged) and c.created_at > r.finished_at) then
    raise exception using errcode = '55000', message = 'LEDGER_AUTO_UNDO_CHANGED: a marked record was changed afterwards';
  end if;

  insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, detail)
  values (r.workspace_id, 'note', 'auto_runs', r.id, pg_catalog.jsonb_build_object('action', 'auto_undo', 'records', pg_catalog.cardinality(v_created)));

  delete from public.app_ledger_record_sources where id = any (v_lines) and workspace_id = r.workspace_id;
  get diagnostics v_unlinked = row_count;

  update public.app_ledger_records x set validity = c.prev
    from (select ch.record_id, ch.detail ->> 'prev_validity' as prev from public.app_ledger_record_changes ch
            where ch.workspace_id = r.workspace_id and ch.run_id = r.id and ch.action = 'needs_check') c
    where x.id = c.record_id and x.workspace_id = r.workspace_id and x.validity = 'needs_check' and c.prev in ('current', 'fulfilled');
  get diagnostics v_restored = row_count;

  for v_id in select unnest(v_created) loop
    update public.app_ledger_records set validity = 'retired'
      where id = v_id and workspace_id = r.workspace_id and validity in ('current', 'needs_check', 'fulfilled');
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_retired := v_retired + 1;
      perform private.app_auto_ledger_log(r.workspace_id, v_id, 'retired', 'auto', r.id, null, null, null,
        '명진이 취소 · ' || v_today, '{}'::jsonb, null);
    end if;
  end loop;

  update public.app_ledger_auto_runs set status = 'undone', undone_at = pg_catalog.now() where id = r.id and status = 'done';
  return pg_catalog.jsonb_build_object('run_id', r.id, 'status', 'undone', 'records_retired', v_retired,
    'sources_unlinked', v_unlinked, 'needs_check_restored', v_restored);
end
$$;

-- 원장 수정 요청 반영. 요청 모양:
--   { format: 'kptu-ledger-fix', version: 1, received_from?: 'claude_chat'|'user',
--     items: [ {target: 기록 ID, do: 'replace'|'retire'|'add_source', set?: {바꿀 칸만}, reason: 이유, source?: {...}, locator?} ] }   (최대 20개)
--   replace: 옛 기록 칸을 복사해 set만 바꾼 새 기록을 만들고 옛 기록은 superseded('대체됨', 이유 "명진 지적으로 수정: …"). 근거·연결 줄은 새 기록에 복사.
--   retire:  틀린 기록 폐기(retired, 지우지 않음).
--   add_source: 기존 기록에 근거 줄 추가(기존 출처 ID 또는 Web2 원문).
--   바꿀 수 있는 칸: 제목·요지·주제·민감도(S0~S2)·중요도·범위·기준일 칸·종류별 칸·비고. 종류·고정 ID·유효상태는 못 바꾼다.
--   하나라도 틀리면(대상 없음·이미 대체·폐기·같은 대상 두 번·모양) 요청 전체를 거절한다(부분 반영 없음). p_dry_run이면 전·후만 돌려주고 모두 취소한다.
-- 반환 {dry_run, fix_request_id, applied, items:[{target, do, changes:[{field, before, after}], new_ledger_id}]}.
create function public.app_apply_ledger_fix(p_workspace_id uuid, p_request jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_items jsonb;
  v_item jsonb;
  v_idx integer;
  v_fix uuid;
  v_from text;
  v_do text;
  v_set jsonb;
  v_reason text;
  v_target text;
  v_targets text[] := '{}';
  old public.app_ledger_records%rowtype;
  v_rec jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_key text;
  v_line uuid;
  v_source uuid;
  v_n integer;
  v_preview jsonb := '[]'::jsonb;
  v_list jsonb := '[]'::jsonb;
  v_result jsonb;
  v_today text := pg_catalog.to_char((pg_catalog.now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  v_msg text;
  v_constraint text;
begin
  if p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_FIX_NOT_OWNER';
  end if;
  if p_dry_run is null or p_request is null or pg_catalog.jsonb_typeof(p_request) <> 'object' or octet_length(p_request::text) > 65536
     or (p_request ->> 'format') is distinct from 'kptu-ledger-fix' or (p_request ->> 'version') is distinct from '1'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_request) k where k not in ('format', 'version', 'received_from', 'items'))
     or coalesce(p_request ->> 'received_from', 'claude_chat') not in ('claude_chat', 'user') then
    raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: format';
  end if;
  v_items := p_request -> 'items';
  v_from := coalesce(p_request ->> 'received_from', 'claude_chat');
  if pg_catalog.jsonb_typeof(v_items) is distinct from 'array' or pg_catalog.jsonb_array_length(v_items) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: items';
  end if;

  begin
    insert into public.app_ledger_fix_requests (workspace_id, received_from, request)
    values (p_workspace_id, v_from, p_request) returning id into v_fix;

    for v_item, v_idx in select e, o::integer from pg_catalog.jsonb_array_elements(v_items) with ordinality as t(e, o) order by o loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('target', 'do', 'set', 'reason', 'source', 'locator')) then
        raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: item keys';
      end if;
      v_target := v_item ->> 'target';
      v_do := v_item ->> 'do';
      v_set := v_item -> 'set';
      v_reason := pg_catalog.btrim(coalesce(v_item ->> 'reason', ''));
      if v_target is null or v_target !~ '^[A-Z]{2,6}-[0-9]{4,6}$' or v_target = any (v_targets)
         or v_do is null or v_do not in ('replace', 'retire', 'add_source')
         or pg_catalog.char_length(v_reason) > 300 or v_reason ~ '[[:cntrl:]]' or private.app_auto_ledger_personal(v_reason)
         or (v_do in ('replace', 'retire') and v_reason = '')
         or (v_do = 'replace' and (v_set is null or pg_catalog.jsonb_typeof(v_set) <> 'object' or v_set = '{}'::jsonb))
         or (v_do <> 'replace' and v_set is not null)
         or (v_do = 'add_source' and (v_item -> 'source') is null)
         or (v_do <> 'add_source' and ((v_item ? 'source') or (v_item ? 'locator'))) then
        raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: item ' || v_idx::text;
      end if;
      v_targets := v_targets || v_target;
      select * into old from public.app_ledger_records x where x.workspace_id = p_workspace_id and x.ledger_id = v_target for update;
      if not found then
        raise exception using errcode = '23503', message = 'LEDGER_FIX_BROKEN_REF: target ' || v_target;
      end if;
      if old.validity not in ('current', 'needs_check', 'fulfilled') then
        raise exception using errcode = '55000', message = 'LEDGER_FIX_TARGET_INACTIVE: ' || v_target || ' is already replaced or retired';
      end if;

      if v_do = 'replace' then
        if exists (select 1 from pg_catalog.jsonb_object_keys(v_set) k where k not in (
             'title', 'summary', 'scope', 'topic', 'sensitivity', 'importance', 'confidence', 'verification', 'date_start', 'date_end',
             'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
             'commitment_status', 'follow_up_on', 'note')) then
          raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: set field';
        end if;
        select pg_catalog.jsonb_object_agg(k.key, k.value) into v_rec from pg_catalog.jsonb_each(pg_catalog.to_jsonb(old)) k
          where k.key in ('summary', 'scope', 'topic_id', 'importance', 'confidence', 'verification', 'date_start', 'date_end',
            'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
            'commitment_status', 'follow_up_on', 'note');
        v_rec := v_rec || (v_set - 'title' - 'sensitivity') || pg_catalog.jsonb_build_object('validity',
          case when old.validity = 'fulfilled' then 'fulfilled' else 'current' end);
        if v_set ? 'topic' then
          v_rec := v_rec - 'topic_id';
        end if;
        v_new := private.app_auto_ledger_insert(p_workspace_id, old.kind, coalesce(v_set ->> 'title', old.title),
          coalesce(v_set ->> 'sensitivity', old.sensitivity), v_rec);
        insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator, note)
          select s.workspace_id, (v_new ->> 'id')::uuid, s.source_id, s.locator, s.note
            from public.app_ledger_record_sources s where s.record_id = old.id;
        insert into public.app_ledger_links (workspace_id, record_id, target_record_id, target_organization_id, target_project_id,
          target_meeting_id, relation, note)
          select l.workspace_id, (v_new ->> 'id')::uuid, l.target_record_id, l.target_organization_id, l.target_project_id,
            l.target_meeting_id, l.relation, l.note
            from public.app_ledger_links l where l.record_id = old.id;
        update public.app_ledger_records
          set validity = 'superseded', superseded_by = (v_new ->> 'id')::uuid, supersede_reason = '명진 지적으로 수정: ' || v_reason
          where id = old.id and workspace_id = p_workspace_id and validity in ('current', 'needs_check', 'fulfilled');
        perform private.app_auto_ledger_log(p_workspace_id, (v_new ->> 'id')::uuid, 'created', 'correction', null, v_fix, null, null,
          '명진 지적으로 수정 · ' || v_today, pg_catalog.jsonb_build_object('replaces', old.ledger_id), null);
        perform private.app_auto_ledger_log(p_workspace_id, old.id, 'replaced', 'correction', null, v_fix, null, null,
          '대체됨 · ' || v_today, pg_catalog.jsonb_build_object('prev_validity', old.validity,
            'prev_supersede_reason', old.supersede_reason, 'replaced_by', v_new ->> 'ledger_id'), null);
        v_changes := '[]'::jsonb;
        for v_key in select k from pg_catalog.jsonb_object_keys(v_set) k order by k loop
          v_changes := v_changes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', v_key,
            'before', case when v_key = 'topic' then pg_catalog.to_jsonb(old) -> 'topic_id' else pg_catalog.to_jsonb(old) -> v_key end,
            'after', v_set -> v_key));
        end loop;
        v_preview := v_preview || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'replace',
          'reason', v_reason, 'changes', v_changes));
        v_list := v_list || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'replace',
          'new', v_new ->> 'ledger_id'));
      elsif v_do = 'retire' then
        update public.app_ledger_records set validity = 'retired'
          where id = old.id and workspace_id = p_workspace_id and validity in ('current', 'needs_check', 'fulfilled');
        perform private.app_auto_ledger_log(p_workspace_id, old.id, 'retired', 'correction', null, v_fix, null, null,
          pg_catalog.left('명진 지적으로 폐기 · ' || v_today || ': ' || v_reason, 300),
          pg_catalog.jsonb_build_object('prev_validity', old.validity), null);
        v_preview := v_preview || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'retire',
          'reason', v_reason, 'changes', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'validity',
            'before', old.validity, 'after', 'retired'))));
        v_list := v_list || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'retire'));
      else
        v_source := private.app_auto_ledger_source(p_workspace_id, v_item -> 'source');
        v_line := null;
        insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator)
        values (p_workspace_id, old.id, v_source, coalesce(v_item ->> 'locator', ''))
        on conflict on constraint app_ledger_record_sources_key do nothing
        returning id into v_line;
        if v_line is not null then
          perform private.app_auto_ledger_log(p_workspace_id, old.id, 'source_added', 'correction', null, v_fix, 'record_sources', v_line,
            pg_catalog.left('근거 추가 · ' || v_today, 300), '{}'::jsonb, null);
        end if;
        v_preview := v_preview || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'add_source',
          'reason', v_reason, 'changes', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'source',
            'before', null, 'after', case when v_line is null then 'already attached' else 'added' end))));
        v_list := v_list || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', v_target, 'do', 'add_source'));
      end if;
    end loop;

    update public.app_ledger_fix_requests set result = pg_catalog.jsonb_build_object('items', v_list) where id = v_fix;
    v_result := pg_catalog.jsonb_build_object('dry_run', p_dry_run, 'fix_request_id', v_fix, 'applied', pg_catalog.jsonb_array_length(v_list),
      'items', v_preview);
    if p_dry_run then
      raise exception using errcode = 'LDRY2', message = 'LEDGER_FIX_DRY_RUN';
    end if;
  exception
    when sqlstate 'LDRY2' then
      return v_result || pg_catalog.jsonb_build_object('fix_request_id', null);
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or foreign_key_violation or insufficient_privilege or unique_violation then
      get stacked diagnostics v_msg = message_text, v_constraint = constraint_name;
      if v_msg like 'LEDGER\_%' then
        raise exception using errcode = sqlstate, message = v_msg;
      end if;
      raise exception using errcode = sqlstate, message = 'LEDGER_FIX_BAD_RECORD: ' || coalesce(nullif(v_constraint, ''), sqlstate);
  end;
  return v_result;
end
$$;

-- 수정 요청 반영 취소. 반환 {fix_request_id, status: undone, records_retired, targets_restored, sources_unlinked}.
-- 새 기록은 폐기(지우지 않음), 대체됨·폐기됐던 옛 기록은 고치기 전 유효상태로, 더한 근거 줄은 뗀다.
-- 거절(아무것도 안 바뀜): 새 기록이 그 뒤 고쳐졌거나 다른 기록·후보·다른 요청이 가리킬 때, 대상·줄이 그 뒤 바뀌었을 때.
create function public.app_undo_ledger_fix(p_fix_request_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  f public.app_ledger_fix_requests%rowtype;
  v_created uuid[];
  v_lines uuid[];
  v_targets uuid[];
  v_today text := pg_catalog.to_char((pg_catalog.now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  v_id uuid;
  v_retired integer := 0;
  v_restored integer := 0;
  v_unlinked integer := 0;
  v_n integer;
begin
  select * into f from public.app_ledger_fix_requests where id = p_fix_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEDGER_FIX_UNDO_NOT_FOUND';
  end if;
  if not private.app_is_workspace_owner(f.workspace_id) then
    raise exception using errcode = '42501', message = 'LEDGER_FIX_NOT_OWNER';
  end if;
  if f.status <> 'applied' then
    raise exception using errcode = '55000', message = 'LEDGER_FIX_UNDO_NOT_APPLIED';
  end if;
  select coalesce(pg_catalog.array_agg(c.record_id), '{}') into v_created from public.app_ledger_record_changes c
    where c.workspace_id = f.workspace_id and c.fix_request_id = f.id and c.action = 'created';
  select coalesce(pg_catalog.array_agg(c.line_id), '{}') into v_lines from public.app_ledger_record_changes c
    where c.workspace_id = f.workspace_id and c.fix_request_id = f.id and c.action = 'source_added';
  select coalesce(pg_catalog.array_agg(c.record_id), '{}') into v_targets from public.app_ledger_record_changes c
    where c.workspace_id = f.workspace_id and c.fix_request_id = f.id and c.action in ('replaced', 'retired');

  if exists (select 1 from public.app_ledger_records x where x.id = any (v_created) and x.updated_at <> x.created_at) then
    raise exception using errcode = '55000', message = 'LEDGER_FIX_UNDO_CHANGED: a new record of this request was edited afterwards';
  end if;
  if exists (select 1 from public.app_ledger_links l where l.target_record_id = any (v_created) and l.record_id <> all (v_created))
     or exists (select 1 from public.app_ledger_records x where x.superseded_by = any (v_created) and x.id <> all (v_targets))
     or exists (select 1 from public.app_ledger_record_changes c where c.record_id = any (v_created) and c.fix_request_id is distinct from f.id)
     or exists (select 1 from public.app_ledger_candidates x where x.workspace_id = f.workspace_id
         and (x.target_record_id = any (v_created) or x.result_record_id = any (v_created))) then
    raise exception using errcode = '55000', message = 'LEDGER_FIX_UNDO_REFERENCED: another record, request or candidate points to a new record of this request';
  end if;
  if exists (select 1 from public.app_ledger_audit a
       where a.workspace_id = f.workspace_id and a.created_at > f.applied_at
         and ((a.target_table = 'record_sources' and a.target_id = any (v_lines))
           or (a.target_table = 'records' and a.target_id = any (v_targets)))) then
    raise exception using errcode = '55000', message = 'LEDGER_FIX_UNDO_CHANGED: a target or line of this request was edited afterwards';
  end if;
  if exists (select 1 from public.app_ledger_record_changes c where c.record_id = any (v_targets) and c.created_at > f.applied_at) then
    raise exception using errcode = '55000', message = 'LEDGER_FIX_UNDO_CHANGED: a target was changed afterwards';
  end if;

  insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, detail)
  values (f.workspace_id, 'note', 'fix_requests', f.id, pg_catalog.jsonb_build_object('action', 'fix_undo', 'records', pg_catalog.cardinality(v_created)));

  delete from public.app_ledger_record_sources where id = any (v_lines) and workspace_id = f.workspace_id;
  get diagnostics v_unlinked = row_count;

  -- 대상 복원(대체됨 해제를 먼저, 그다음 새 기록 폐기: 대체 CHECK가 짝을 요구한다).
  update public.app_ledger_records x
    set validity = c.prev, superseded_by = null, supersede_reason = c.prev_reason
    from (select ch.record_id, ch.detail ->> 'prev_validity' as prev, ch.detail ->> 'prev_supersede_reason' as prev_reason
            from public.app_ledger_record_changes ch
            where ch.workspace_id = f.workspace_id and ch.fix_request_id = f.id and ch.action = 'replaced') c
    where x.id = c.record_id and x.workspace_id = f.workspace_id and x.validity = 'superseded' and x.superseded_by = any (v_created)
      and c.prev in ('current', 'needs_check', 'fulfilled');
  get diagnostics v_restored = row_count;
  update public.app_ledger_records x set validity = c.prev
    from (select ch.record_id, ch.detail ->> 'prev_validity' as prev from public.app_ledger_record_changes ch
            where ch.workspace_id = f.workspace_id and ch.fix_request_id = f.id and ch.action = 'retired'
              and ch.record_id <> all (v_created)) c
    where x.id = c.record_id and x.workspace_id = f.workspace_id and x.validity = 'retired'
      and c.prev in ('current', 'needs_check', 'fulfilled');
  get diagnostics v_n = row_count;
  v_restored := v_restored + v_n;

  for v_id in select unnest(v_created) loop
    update public.app_ledger_records set validity = 'retired'
      where id = v_id and workspace_id = f.workspace_id and validity in ('current', 'needs_check', 'fulfilled');
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_retired := v_retired + 1;
      perform private.app_auto_ledger_log(f.workspace_id, v_id, 'retired', 'correction', null, f.id, null, null,
        '반영 취소 · ' || v_today, '{}'::jsonb, null);
    end if;
  end loop;

  update public.app_ledger_fix_requests set status = 'undone', undone_at = pg_catalog.now() where id = f.id and status = 'applied';
  return pg_catalog.jsonb_build_object('fix_request_id', f.id, 'status', 'undone', 'records_retired', v_retired,
    'targets_restored', v_restored, 'sources_unlinked', v_unlinked);
end
$$;

revoke all on function private.app_auto_ledger_personal(text) from public, anon, service_role;
revoke all on function private.app_auto_ledger_source(uuid,jsonb) from public, anon, service_role;
revoke all on function private.app_auto_ledger_insert(uuid,text,text,text,jsonb) from public, anon, service_role;
revoke all on function private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text) from public, anon, service_role;
revoke all on function public.app_auto_ledger_begin(uuid) from public, anon, service_role;
revoke all on function public.app_auto_ledger_record(uuid,jsonb) from public, anon, service_role;
revoke all on function public.app_auto_ledger_undo(uuid) from public, anon, service_role;
revoke all on function public.app_apply_ledger_fix(uuid,jsonb,boolean) from public, anon, service_role;
revoke all on function public.app_undo_ledger_fix(uuid) from public, anon, service_role;
grant execute on function private.app_auto_ledger_personal(text) to authenticated;
grant execute on function private.app_auto_ledger_source(uuid,jsonb) to authenticated;
grant execute on function private.app_auto_ledger_insert(uuid,text,text,text,jsonb) to authenticated;
grant execute on function private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text) to authenticated;
grant execute on function public.app_auto_ledger_begin(uuid) to authenticated;
grant execute on function public.app_auto_ledger_record(uuid,jsonb) to authenticated;
grant execute on function public.app_auto_ledger_undo(uuid) to authenticated;
grant execute on function public.app_apply_ledger_fix(uuid,jsonb,boolean) to authenticated;
grant execute on function public.app_undo_ledger_fix(uuid) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_class where oid in (to_regclass('public.app_ledger_auto_runs'), to_regclass('public.app_ledger_auto_sources'),
        to_regclass('public.app_ledger_fix_requests'), to_regclass('public.app_ledger_record_changes')) and relrowsecurity
        and coalesce(relacl::text, '') !~ '(^|[{,])(anon|service_role)?=') <> 4
     or (select count(*) from pg_policy where polrelid in (to_regclass('public.app_ledger_auto_runs'), to_regclass('public.app_ledger_auto_sources'),
        to_regclass('public.app_ledger_fix_requests'), to_regclass('public.app_ledger_record_changes'))
        and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]) <> 4
     or (select count(*) from pg_policy where polrelid in (to_regclass('public.app_ledger_auto_runs'), to_regclass('public.app_ledger_auto_sources'),
        to_regclass('public.app_ledger_fix_requests'), to_regclass('public.app_ledger_record_changes'))) <> 4
     or exists (select 1 from pg_attribute where attrelid in (to_regclass('public.app_ledger_auto_runs'), to_regclass('public.app_ledger_auto_sources'),
        to_regclass('public.app_ledger_fix_requests'), to_regclass('public.app_ledger_record_changes'))
        and coalesce(attacl::text, '') ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_ledger_record_changes', 'update,delete,truncate')
     or has_table_privilege('authenticated', 'public.app_ledger_auto_runs', 'delete,truncate')
     or has_table_privilege('authenticated', 'public.app_ledger_auto_sources', 'delete,truncate')
     or has_table_privilege('authenticated', 'public.app_ledger_fix_requests', 'delete,truncate')
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and p.proname in ('app_auto_ledger_begin', 'app_auto_ledger_record', 'app_auto_ledger_undo',
            'app_apply_ledger_fix', 'app_undo_ledger_fix', 'app_auto_ledger_personal', 'app_auto_ledger_source', 'app_auto_ledger_insert',
            'app_auto_ledger_log')
          and not p.prosecdef and p.proconfig = array['search_path=""']
          and p.proacl is not null and p.proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 9
     or has_function_privilege('anon', 'public.app_auto_ledger_record(uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_apply_ledger_fix(uuid,jsonb,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_auto_ledger_record(uuid,jsonb)', 'execute')
     or not exists (select 1 from pg_constraint where conrelid = 'public.app_ledger_audit'::regclass
         and conname = 'app_ledger_audit_target_check' and pg_get_constraintdef(oid) like '%auto_runs%' and pg_get_constraintdef(oid) like '%fix_requests%') then
    raise exception 'LEDGER_AUTO_RECORD_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024120000', 'ledger_auto_record', array['LEDGER-자동기록 DB: app_ledger_auto_runs, app_ledger_auto_sources, app_ledger_fix_requests, app_ledger_record_changes (owner RLS, authenticated only, no anon/PUBLIC/service_role) + audit target CHECK values + app_auto_ledger_begin/record/undo, app_apply_ledger_fix, app_undo_ledger_fix (SECURITY INVOKER, add-only, replaced via superseded) + 4 private helpers']);
commit;
