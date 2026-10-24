begin;
-- LEDGER-수정요청(설계 docs/design/ledger-auto-record.md 7절·10절 4번, 명진 요청 2026-10-24 07:17: [+ 기록하기]·⋯ [고치기] 일상어 칸).
-- 앞 단계: 20261024120000_ledger_auto_record(수정 요청 함수 app_apply_ledger_fix). 화면 PR이 이 함수를 쓴다. 앱·Edge 코드 변경 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 무엇: 수정 요청 함수 app_apply_ledger_fix 하나를 같은 서명으로 넓힌다(새 함수·표·정책·권한 없음).
--   items에 do:'add' 하나를 더한다 = 명진이 직접 넣는 새 기록(대상 ID 없음).
--     {do:'add', kind:'event'|'change'|'decision'|'evidence'|'commitment', set:{title 필수, 그 밖은 replace와 같은 칸}, reason?,
--      belongs_to?: 사건 ID(kind=change일 때만, 꼭), links?: [{target_organization: 원장 조직 ID, relation?}] (10개까지), source?, locator?}
--   새 기록은 기존 도우미(private.app_auto_ledger_insert·_source)로 만들고, 변경 기록에 created·correction("명진이 직접 기록 · 날짜")을 남긴다.
--   기존 replace·retire·add_source 동작과 검사는 그대로다(바꾼 곳: item 키 목록·검사 조건에 add 경로를 더함).
--   되돌리기는 기존 app_undo_ledger_fix가 그대로 한다(그 요청이 만든 기록은 폐기, 지우지 않음).
-- 권한: INVOKER·search_path 빈칸·authenticated만 실행(PUBLIC·anon·service_role 없음) 그대로. 기존 owner RLS·칸 권한·감사 트리거가 그대로 걸린다.
-- 되돌리기(짝 rollback, SQL Editor 경로): 이 함수 본문을 앞 단계 모양으로 되돌린다. add로 만든 기록은 그대로 남는다(지우지 않음).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 적용되지 않았거나, 이미 적용됐거나, 함수가 예상 모양(INVOKER·search_path 빈칸·anon 실행권 없음, add 경로 없음)이 아니면 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024190000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024120000' and name = 'ledger_auto_record') <> 1
     or to_regclass('public.app_ledger_fix_requests') is null
     or to_regclass('public.app_ledger_record_changes') is null
     or to_regprocedure('private.app_auto_ledger_insert(uuid,text,text,text,jsonb)') is null
     or to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') is null
     or to_regprocedure('private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)') is null
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%명진이 직접 기록%'
         and coalesce(proacl::text, '') !~ '(^|[{,])(anon|service_role)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1 then
    raise exception 'LEDGER_FIX_ADD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 원장 수정 요청 반영(LEDGER-수정요청 판). 앞 판의 replace·retire·add_source에 add를 더했다. 요청 모양은 20261024120000 주석과 같고,
-- add는 대상 없이 새 기록 하나: 종류(kind)·제목(set.title) 필수, 변화(change)는 belongs_to(사건 ID) 필수, 조직 연결(links)은 원장 조직 ID로.
-- 하나라도 틀리면 요청 전체를 거절한다(부분 반영 없음). p_dry_run이면 전·후만 돌려주고 모두 취소한다.
create or replace function public.app_apply_ledger_fix(p_workspace_id uuid, p_request jsonb, p_dry_run boolean)
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
  v_kind text;
  v_link jsonb;
  v_t_org uuid;
  v_belongs uuid;
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
         or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('target', 'do', 'set', 'reason', 'source', 'locator', 'kind', 'belongs_to', 'links')) then
        raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: item keys';
      end if;
      v_target := v_item ->> 'target';
      v_do := v_item ->> 'do';
      v_set := v_item -> 'set';
      v_reason := pg_catalog.btrim(coalesce(v_item ->> 'reason', ''));
      -- add(새 기록, 명진이 직접): 대상 없음, 종류·제목 필수. 나머지(replace·retire·add_source)는 대상 필수.
      if v_do is null or v_do not in ('replace', 'retire', 'add_source', 'add')
         or (v_do = 'add' and (v_target is not null or (v_item ->> 'kind') is null
             or (v_item ->> 'kind') not in ('event', 'change', 'decision', 'evidence', 'commitment')
             or v_set is null or pg_catalog.jsonb_typeof(v_set) <> 'object' or coalesce(pg_catalog.btrim(v_set ->> 'title'), '') = ''
             or ((v_item ->> 'kind') = 'change') <> (v_item ? 'belongs_to')
             or pg_catalog.jsonb_typeof(coalesce(v_item -> 'links', '[]'::jsonb)) <> 'array'
             or pg_catalog.jsonb_array_length(coalesce(v_item -> 'links', '[]'::jsonb)) > 10))
         or (v_do <> 'add' and ((v_item ? 'kind') or (v_item ? 'belongs_to') or (v_item ? 'links')))
         or (v_do <> 'add' and (v_target is null or v_target !~ '^[A-Z]{2,6}-[0-9]{4,6}$' or v_target = any (v_targets)))
         or pg_catalog.char_length(v_reason) > 300 or v_reason ~ '[[:cntrl:]]' or private.app_auto_ledger_personal(v_reason)
         or (v_do in ('replace', 'retire') and v_reason = '')
         or (v_do = 'replace' and (v_set is null or pg_catalog.jsonb_typeof(v_set) <> 'object' or v_set = '{}'::jsonb))
         or (v_do not in ('replace', 'add') and v_set is not null)
         or (v_do = 'add_source' and (v_item -> 'source') is null)
         or (v_do in ('replace', 'retire') and ((v_item ? 'source') or (v_item ? 'locator'))) then
        raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: item ' || v_idx::text;
      end if;
      if v_do = 'add' then
        if exists (select 1 from pg_catalog.jsonb_object_keys(v_set) k where k not in (
             'title', 'summary', 'scope', 'topic', 'sensitivity', 'importance', 'confidence', 'verification', 'date_start', 'date_end',
             'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
             'commitment_status', 'follow_up_on', 'note')) then
          raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: set field';
        end if;
        v_kind := v_item ->> 'kind';
        v_belongs := null;
        if v_item ? 'belongs_to' then
          select x.id into v_belongs from public.app_ledger_records x
            where x.workspace_id = p_workspace_id and x.ledger_id = (v_item ->> 'belongs_to') and x.kind = 'event'
              and x.validity in ('current', 'needs_check');
          if v_belongs is null then
            raise exception using errcode = '23503', message = 'LEDGER_FIX_BROKEN_REF: belongs_to ' || coalesce(v_item ->> 'belongs_to', '?');
          end if;
        end if;
        v_new := private.app_auto_ledger_insert(p_workspace_id, v_kind, v_set ->> 'title', coalesce(v_set ->> 'sensitivity', 'S1'),
          (v_set - 'title' - 'sensitivity') || pg_catalog.jsonb_build_object('validity', 'current'));
        if v_item ? 'source' then
          v_source := private.app_auto_ledger_source(p_workspace_id, v_item -> 'source');
          insert into public.app_ledger_record_sources (workspace_id, record_id, source_id, locator)
          values (p_workspace_id, (v_new ->> 'id')::uuid, v_source, coalesce(v_item ->> 'locator', ''));
        end if;
        if v_belongs is not null then
          insert into public.app_ledger_links (workspace_id, record_id, target_record_id, relation)
          values (p_workspace_id, (v_new ->> 'id')::uuid, v_belongs, 'belongs_to');
        end if;
        for v_link in select e from pg_catalog.jsonb_array_elements(coalesce(v_item -> 'links', '[]'::jsonb)) e loop
          if pg_catalog.jsonb_typeof(v_link) <> 'object'
             or exists (select 1 from pg_catalog.jsonb_object_keys(v_link) k where k not in ('target_organization', 'relation'))
             or (v_link ->> 'target_organization') is null then
            raise exception using errcode = '22023', message = 'LEDGER_FIX_BAD_REQUEST: links';
          end if;
          select o.id into v_t_org from public.app_ledger_organizations o
            where o.workspace_id = p_workspace_id and o.ledger_id = (v_link ->> 'target_organization') and o.status = 'active';
          if v_t_org is null then
            raise exception using errcode = '23503', message = 'LEDGER_FIX_BROKEN_REF: organization ' || (v_link ->> 'target_organization');
          end if;
          insert into public.app_ledger_links (workspace_id, record_id, target_organization_id, relation)
          values (p_workspace_id, (v_new ->> 'id')::uuid, v_t_org, coalesce(v_link ->> 'relation', 'direct'))
          on conflict on constraint app_ledger_links_unique do nothing;
        end loop;
        perform private.app_auto_ledger_log(p_workspace_id, (v_new ->> 'id')::uuid, 'created', 'correction', null, v_fix, null, null,
          '명진이 직접 기록 · ' || v_today, pg_catalog.jsonb_build_object('added', true), null);
        v_changes := '[]'::jsonb;
        for v_key in select k from pg_catalog.jsonb_object_keys(v_set) k order by k loop
          v_changes := v_changes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', v_key, 'before', null, 'after', v_set -> v_key));
        end loop;
        v_preview := v_preview || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', null, 'do', 'add', 'kind', v_kind,
          'reason', v_reason, 'changes', v_changes));
        v_list := v_list || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target', null, 'do', 'add', 'new', v_new ->> 'ledger_id'));
        continue;
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

revoke all on function public.app_apply_ledger_fix(uuid,jsonb,boolean) from public, anon, service_role;
grant execute on function public.app_apply_ledger_fix(uuid,jsonb,boolean) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)')
      and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%명진이 직접 기록%'
      and coalesce(proacl::text, '') !~ '(^|[{,])(anon|service_role)?=') <> 1
     or has_function_privilege('anon', 'public.app_apply_ledger_fix(uuid,jsonb,boolean)', 'execute')
     or has_function_privilege('service_role', 'public.app_apply_ledger_fix(uuid,jsonb,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_apply_ledger_fix(uuid,jsonb,boolean)', 'execute') then
    raise exception 'LEDGER_FIX_ADD_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024190000', 'ledger_fix_add', array['LEDGER-수정요청: app_apply_ledger_fix accepts do=add (new record by the owner, kind/title required, change needs belongs_to, org links) — same signature, SECURITY INVOKER, authenticated only']);
commit;
