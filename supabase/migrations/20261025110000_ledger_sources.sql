begin;
-- LEDGER-재료 공통 DB (docs/design/ledger-sources.md 3절·9절, 명진 결정 2026-10-25 10:29: 10절 질문 14개 모두 추천대로). 앱·Edge 코드 변경 없음.
-- 원장 자동 기록(ai-assist ledger_auto)이 읽을 새 원문 종류 셋(통화 call, 주간보고 개인본 weekly_personal, 개인 공유 캘린더 일정 calendar_ref)을 DB가 받게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 무엇:
--   1) 원문 종류 목록을 한 곳으로 모은다: 도우미 함수 private.app_auto_ledger_source_kind_ok(text) 하나(아홉 종류).
--      지금은 같은 여섯 종류가 DB 함수 안 두 곳(출처 도우미 app_auto_ledger_source, 실행 기록 함수 app_auto_ledger_record)에 글자로 박혀 있다.
--      그 두 함수를 같은 서명으로 교체해 이 도우미를 부르게 한다. 바뀐 곳은 종류 검사 두 줄뿐이고 나머지는 앞 단계(20261024120000)와 한 글자도 다르지 않다.
--   2) 처리 표 app_ledger_auto_sources의 종류 CHECK(app_ledger_auto_sources_kind_check)에 call·weekly_personal·calendar_ref 세 값을 더한다(값 목록만 넓힘).
--      CHECK는 도우미를 부르지 않고 글자로 둔다(표 넣기 권한이 함수·스키마 권한에 기대지 않게). 두 목록이 같은지는 시험이 대조한다.
--   3) 새 표 app_calendar_work_refs(개인 공유 캘린더 참고 일정): 업무 또는 애매로 판단된 일정의 제목·날짜만. 일정·캘린더 ID 원문, 설명·장소·참석자·이메일은 칸이 없다
--      (event_key는 지문 32자). owner 정책 하나(private.app_is_workspace_owner), authenticated만, PUBLIC·anon·service_role 권한 없음, 칸 단위 grant, SECURITY DEFINER 없음.
--      넣기 트리거 하나(INVOKER): 연결 조직이 같은 작업공간인지 public 표를 직접 읽어 검사하고(private 함수를 부르지 않음), 내용이 바뀐 수정이면 updated_at을 올린다
--      (원장 처리 표가 이 시각이 바뀌면 다시 보므로, 앱이 올리는 것을 믿지 않는다).
--   4) app_profiles.ledger_calendar jsonb not null default '{}' 칸 하나 + CHECK(객체, 키는 calendar·colors·mine만, 2KB): 참고할 개인 공유 캘린더 고르기.
--      표 권한·정책은 바꾸지 않는다(기존 owner 정책과 UPDATE 권한 그대로, 20261023180000_profile_view_prefs 선례).
-- 안 하는 것: ai-assist·google-calendar Edge, 화면, draft.issued(앱 PR), 기존 기록·근거·권한 변경, service_role 권한 추가. 서버는 아직 새 종류를 읽지 않으므로 지금 자동 기록은 그대로 돈다.
-- service_role 경로: 새 객체에 service_role 권한이 없고, ai-assist는 명진 로그인 토큰(authenticated)으로만 이 함수들을 부른다. schema private를 service_role이 부르는 경로가 없다
--   (20261024210000_feed_item_guard_public이 고친 42501 문제와 같은 일이 생기지 않는 구조).
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 새 종류의 처리 표 행·출처, 참고 일정 행, 프로필 고르기 값이 하나라도 있으면 멈춘다. 없으면 함수 두 개를 옛 본문으로 되돌리고 표·칸·도우미·CHECK를 걷어 낸다.
-- 짝: docs/20261025110000_ledger_sources.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 없거나, 이미 적용됐거나, 함수·표·권한이 예상 모양이 아니면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025110000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024120000' and name = 'ledger_auto_record') <> 1
     or to_regclass('public.app_ledger_auto_sources') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_profiles') is null
     or to_regclass('public.app_calendar_work_refs') is not null
     or to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') is not null
     or to_regprocedure('private.app_calendar_work_ref_guard()') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or exists (select 1 from pg_attribute where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'ledger_calendar')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_ledger_calendar_check')
     -- 처리 표 종류 CHECK가 앞 단계 모양(여섯 종류)이다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_ledger_auto_sources'::regclass and conname = 'app_ledger_auto_sources_kind_check'
         and pg_get_constraintdef(oid) not like '%call%' and pg_get_constraintdef(oid) not like '%weekly_personal%' and pg_get_constraintdef(oid) not like '%calendar_ref%') <> 1
     -- 바꿀 두 함수가 앞 단계 본문 그대로다(다른 판이 끼어 있으면 멈춤).
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') and not prosecdef and proconfig = array['search_path=""']
         and md5(prosrc) = '565acb9478f8e095f3b6f20e4acf6565') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') and not prosecdef and proconfig = array['search_path=""']
         and md5(prosrc) = '6c4148b0b31ecfa0b6e1f3050fcc6118') <> 1
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated UPDATE 권한이 이미 있음, 정책 두 개(task12a) 그대로.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     -- 새 표의 조직 검사에 필요한 읽기 권한(authenticated).
     or not has_column_privilege('authenticated', 'public.app_suborganizations', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.app_suborganizations', 'workspace_id', 'select') then
    raise exception 'LEDGER_SOURCES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 원문 종류 도우미: 아홉 종류가 사는 유일한 함수. 모르는 값·null은 false.
create function private.app_auto_ledger_source_kind_ok(p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref'), false)
$$;
revoke all on function private.app_auto_ledger_source_kind_ok(text) from public, anon, service_role;
grant execute on function private.app_auto_ledger_source_kind_ok(text) to authenticated;

-- 2) 처리 표 종류 CHECK에 세 값을 더한다(권한·정책 아님).
alter table public.app_ledger_auto_sources drop constraint app_ledger_auto_sources_kind_check,
  add constraint app_ledger_auto_sources_kind_check check (source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'call', 'weekly_personal', 'calendar_ref'));

-- 3) 앞 단계 함수 두 개를 같은 서명으로 교체. 종류 검사만 도우미로 바꿨다(출처 도우미 1곳, 실행 기록 함수 1곳).
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
  if (p_spec ->> 'kind') is null or not private.app_auto_ledger_source_kind_ok(p_spec ->> 'kind')
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
         or (v_src ->> 'kind') is null or not private.app_auto_ledger_source_kind_ok(v_src ->> 'kind')
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

-- 4) 개인 공유 캘린더 참고 일정(업무 또는 애매로 판단된 것만). 제목은 80자까지, 설명·장소·참석자·캘린더 ID·일정 ID 원문은 칸이 없다.
create table public.app_calendar_work_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  event_key text not null,
  day date not null,
  start_at timestamptz,
  all_day boolean not null default false,
  title text not null,
  judged text not null,
  included boolean not null,
  decided_by text not null default 'rule',
  organization_id uuid references public.app_suborganizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_calendar_work_refs_event_key_check check (event_key ~ '^[0-9a-f]{32}$'),
  constraint app_calendar_work_refs_title_check check (char_length(btrim(title)) between 1 and 80 and title !~ '[[:cntrl:]]'),
  constraint app_calendar_work_refs_judged_check check (judged in ('work', 'unsure')),
  constraint app_calendar_work_refs_decided_by_check check (decided_by in ('rule', 'user')),
  constraint app_calendar_work_refs_event_key_key unique (workspace_id, event_key)
);
create index app_calendar_work_refs_day_idx on public.app_calendar_work_refs(workspace_id, day desc);

-- 넣기·고치기 검사(INVOKER, 실행권 전부 회수): 연결 조직은 같은 작업공간만, 내용이 바뀌면 updated_at 올림. private 함수를 부르지 않는다.
create function private.app_calendar_work_ref_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o where o.id = new.organization_id and o.workspace_id = new.workspace_id) then
    raise exception using errcode = '23514', message = 'CALENDAR_REF_LINK_SCOPE: linked organization must be in the same workspace';
  end if;
  if tg_op = 'UPDATE'
     and (new.title, new.day, new.start_at, new.all_day, new.judged, new.included, new.decided_by, new.organization_id)
       is distinct from (old.title, old.day, old.start_at, old.all_day, old.judged, old.included, old.decided_by, old.organization_id) then
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end
$guard$;
revoke all on function private.app_calendar_work_ref_guard() from public, anon, authenticated, service_role;

create trigger app_calendar_work_refs_guard
before insert or update on public.app_calendar_work_refs
for each row execute function private.app_calendar_work_ref_guard();

alter table public.app_calendar_work_refs enable row level security;
revoke all on table public.app_calendar_work_refs from public, anon, authenticated, service_role;
grant select, delete on table public.app_calendar_work_refs to authenticated;
grant insert (workspace_id, event_key, day, start_at, all_day, title, judged, included, decided_by, organization_id)
  on table public.app_calendar_work_refs to authenticated;
grant update (title, day, start_at, all_day, judged, included, decided_by, organization_id, updated_at)
  on table public.app_calendar_work_refs to authenticated;

create policy calendar_work_refs_owner_all on public.app_calendar_work_refs for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 5) 참고할 개인 공유 캘린더 고르기. 기본 '{}'(아직 안 고름). 값은 소유자 본인 행에만(기존 owner 정책).
--    calendar: Google 캘린더 ID(1~200자), colors: 내 일정 색 번호 글자(숫자 1~2자리) 0~5개, mine: 내가 만든 일정도 포함(참/거짓).
alter table public.app_profiles
  add column ledger_calendar jsonb not null default '{}'::jsonb;
alter table public.app_profiles
  add constraint app_profiles_ledger_calendar_check check (
    case
      when jsonb_typeof(ledger_calendar) <> 'object' then false
      else
        octet_length(ledger_calendar::text) <= 2048
        and not jsonb_path_exists(ledger_calendar, 'strict $.keyvalue() ? (!(@.key == "calendar" || @.key == "colors" || @.key == "mine"))')
        and case when not (ledger_calendar ? 'calendar') then true
              when jsonb_typeof(ledger_calendar -> 'calendar') <> 'string' then false
              else char_length(ledger_calendar ->> 'calendar') between 1 and 200 and (ledger_calendar ->> 'calendar') !~ '[[:cntrl:]]' end
        and case when not (ledger_calendar ? 'colors') then true
              when jsonb_typeof(ledger_calendar -> 'colors') <> 'array' then false
              else jsonb_array_length(ledger_calendar -> 'colors') <= 5
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (@.type() != "string")')
               and not jsonb_path_exists(ledger_calendar, 'strict $.colors[*] ? (!(@ like_regex "^[0-9]{1,2}$"))') end
        and case when not (ledger_calendar ? 'mine') then true
              else jsonb_typeof(ledger_calendar -> 'mine') = 'boolean' end
    end
  );

-- 사후 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_ledger_auto_sources'::regclass and conname = 'app_ledger_auto_sources_kind_check'
      and pg_get_constraintdef(oid) like '%''call''%' and pg_get_constraintdef(oid) like '%''weekly_personal''%'
      and pg_get_constraintdef(oid) like '%''calendar_ref''%' and pg_get_constraintdef(oid) like '%''project_update''%') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') and prosrc like '%''call''%' and prosrc like '%''weekly_personal''%'
         and prosrc like '%''calendar_ref''%' and prosrc like '%''basket''%' and prosrc like '%''project_update''%' and prosrc not like '%telegram%') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'), to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)'))
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%app_auto_ledger_source_kind_ok%'
         and prosrc not like '%''project_update''%' and coalesce(proacl::text, '') !~ '(^|[{,])(anon|service_role)?='
         and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')) <> 2
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_auto_ledger_source_kind_ok(text)'), to_regprocedure('private.app_calendar_work_ref_guard()'))
         and not prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])(anon|service_role)?=') <> 2
     or has_function_privilege('authenticated', 'private.app_calendar_work_ref_guard()', 'execute')
     or exists (select 1 from pg_class where oid = 'public.app_calendar_work_refs'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_calendar_work_refs'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_calendar_work_refs'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or has_any_column_privilege('anon', 'public.app_calendar_work_refs', 'select,insert,update')
     or has_any_column_privilege('service_role', 'public.app_calendar_work_refs', 'select,insert,update')
     or has_table_privilege('service_role', 'public.app_calendar_work_refs', 'delete')
     or has_table_privilege('authenticated', 'public.app_calendar_work_refs', 'truncate')
     or has_column_privilege('authenticated', 'public.app_calendar_work_refs', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_calendar_work_refs', 'event_key', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_calendar_work_refs'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_calendar_work_refs'::regclass) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_calendar_work_refs'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_attribute a where a.attrelid = 'public.app_profiles'::regclass and a.attname = 'ledger_calendar'
         and a.attnotnull and not a.attisdropped) <> 1
     or exists (select 1 from public.app_profiles where ledger_calendar <> '{}'::jsonb)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2 then
    raise exception 'LEDGER_SOURCES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025110000', 'ledger_sources', array['LEDGER-재료 공통 DB: ledger auto source kinds + call/weekly_personal/calendar_ref (helper private.app_auto_ledger_source_kind_ok, kind CHECK widened, source+record functions replaced with the same signature), new table app_calendar_work_refs (owner RLS, authenticated only, INVOKER guard trigger), app_profiles.ledger_calendar jsonb + CHECK']);
commit;
