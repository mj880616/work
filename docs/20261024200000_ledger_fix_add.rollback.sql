begin;
-- 20261024200000_ledger_fix_add의 짝 되돌리기(SQL Editor 경로 전용: 함수 본문 복원은 workflow rollback 허용 목록 밖).
-- 수정 요청 함수 app_apply_ledger_fix 본문만 앞 단계(20261024120000) 모양으로 되돌리고 기록 1행을 지운다.
-- add로 만든 기록·수정 요청 행·변경 기록은 지우지 않는다(원장은 지우지 않음). 화면의 [+ 기록하기]만 저장을 거절하게 된다.
-- 실행권(authenticated만)은 create or replace로 그대로 유지된다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261024200000' and name = 'ledger_fix_add') <> 1 then
    raise exception 'LEDGER_FIX_ADD_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

-- 이전 본문(20261024120000) 그대로.
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

delete from supabase_migrations.schema_migrations where version = '20261024200000' and name = 'ledger_fix_add';
commit;
