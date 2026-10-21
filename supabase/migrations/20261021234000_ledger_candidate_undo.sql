begin;
-- LEDGER-확정되돌리기: 원장 후보 [확정]·[고쳐서 확정]을 되돌리는 함수 1개 + "결정된 후보 잠금" 트리거를 함수 경로만 여는 판으로 바꿈.
-- 앞 단계: 20261021082000_ledger_schema(표·권한·트리거), 20261021190000_ledger_candidates(확정 함수). 설계: docs/design/ledger-web2.md 16절.
-- 표·정책·권한·감사 기록 목록·다른 트리거는 바꾸지 않는다. 새 함수 2개 모두 SECURITY INVOKER·search_path 빈칸이라
-- 기존 owner RLS·칸 권한·고정 ID·감사 기록 트리거가 그대로 걸린다. 실행은 authenticated만(PUBLIC·anon·service_role 없음).
--   app_unconfirm_ledger_candidate : 확정된 후보 하나를 한 거래로 되돌린다.
--     - 그 확정이 만든 기록-출처 연결·기록 간 연결을 지운다(두 표는 원래 지울 수 있다. 지운 행은 감사 기록에 남는다).
--     - 새 기록(new·supersede)은 지우지 않고 "폐기(retired)"로 둔다. 원장 행 삭제는 제한 정책(가져오기 되돌리기만)이 막고,
--       정책을 넓히지 않기 위해서다. 고정 ID 번호는 다시 쓰지 않는다(다시 확정하면 새 번호).
--     - 그 확정이 새로 만든 출처가 다른 곳에 안 쓰이고 고친 적 없으면 "폐기"로 둔다(같은 이유로 지우지 않음).
--     - supersede였으면 대체된 기록을 확정 직전 상태(유효상태·대체이유)로 되돌린다.
--     - 후보는 "대기"로(고쳐서 확정했으면 고친 제목·민감도·내용은 그대로 남아 다시 고칠 수 있다).
--     - 감사 기록: 'note'(action = candidate_unconfirm) 1행 + 기존 트리거가 남기는 candidate_decided(확정 전 값)·row_update·row_delete.
--     거절(아무것도 안 바뀜): 확정 뒤 그 기록·연결·대체 대상이 고쳐졌거나, 다른 기록·후보가 그 기록을 연결·대체·대상으로 가리키거나,
--     가져오기 묶음(시트 이전분)에서 온 기록이거나, 같은 중복 열쇠의 대기 후보가 이미 있을 때.
--   app_guard_ledger_candidate : 후보 잠금 트리거 함수. 기존과 같이 결정된 후보는 못 바꾸되, 딱 하나 "확정 → 대기"만
--     같은 거래 안에 위 함수가 남긴 감사 기록(note·candidate_unconfirm·이 후보)이 있고 제목·내용·민감도가 그대로일 때 허용한다.
-- 가져오기 묶음의 잠금(app_ledger_imports_guard)은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 적용되지 않았거나, 이미 적용됐거나, 같은 이름 함수가 있거나, 후보 잠금 트리거가 예상과 다르면 멈춘다.
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021082000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021190000')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261021234000')
     or to_regclass('public.app_ledger_candidates') is null
     or to_regclass('public.app_ledger_records') is null
     or to_regclass('public.app_ledger_audit') is null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.proname in ('app_unconfirm_ledger_candidate', 'app_guard_ledger_candidate'))
     or not exists (select 1 from pg_trigger t
         where t.tgrelid = to_regclass('public.app_ledger_candidates') and t.tgname = 'app_ledger_candidates_guard'
           and t.tgfoid = to_regprocedure('private.app_ledger_decided_guard()') and t.tgenabled = 'O') then
    raise exception 'LEDGER_UNDO_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 후보 잠금(바꾼 판). 대기 후보는 자유롭게 고친다. 결정된 후보는 못 바꾼다. 예외: 되돌리기 함수가 같은 거래에서 남긴 감사 기록이
-- 있을 때의 "확정 → 대기"(결과 기록·결정 시각 비움, 제목·내용·민감도 그대로). now()는 거래 시작 시각이라 다른 요청에서 넣은
-- 감사 기록으로는 열리지 않는다(PostgREST 요청 하나 = 거래 하나).
create function private.app_guard_ledger_candidate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending' then
    return new;
  end if;
  if old.status = 'confirmed' and new.status = 'pending'
     and new.result_record_id is null and new.decided_at is null and new.discard_reason is null
     and new.title = old.title and new.payload = old.payload and new.sensitivity = old.sensitivity
     and new.action = old.action and new.kind = old.kind and new.target_record_id is not distinct from old.target_record_id
     and exists (select 1 from public.app_ledger_audit a
       where a.workspace_id = old.workspace_id and a.event = 'note' and a.target_table = 'candidates' and a.target_id = old.id
         and a.detail ->> 'action' = 'candidate_unconfirm' and a.created_at = pg_catalog.now()) then
    return new;
  end if;
  raise exception using errcode = '23514', message = 'LEDGER_ALREADY_DECIDED: a decided row cannot change';
end
$$;

-- 확정 되돌리기. 반환: {candidate_id, status: pending, action, record_id, ledger_id, record_retired, target_restored,
--                      sources_unlinked, links_removed, sources_retired}
create function public.app_unconfirm_ledger_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c public.app_ledger_candidates%rowtype;
  r public.app_ledger_records%rowtype;
  v_at timestamptz;
  v_before jsonb;
  v_rs uuid[];
  v_links uuid[];
  v_src uuid[];
  v_unlinked integer := 0;
  v_removed integer := 0;
  v_retired_sources integer := 0;
  v_restored boolean := false;
begin
  select * into c from public.app_ledger_candidates where id = p_candidate_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEDGER_UNDO_NOT_FOUND';
  end if;
  if c.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'LEDGER_UNDO_NOT_CONFIRMED: only a confirmed candidate can be undone';
  end if;
  -- 확정 함수는 한 거래에서 행을 만들고 decided_at = now()를 적으므로, 그 확정이 만든 행의 created_at은 decided_at과 같다.
  v_at := c.decided_at;
  select * into r from public.app_ledger_records where id = c.result_record_id and workspace_id = c.workspace_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEDGER_UNDO_NOT_FOUND: result record';
  end if;
  if c.action in ('new', 'supersede') and (r.import_id is not null or r.created_at <> v_at) then
    raise exception using errcode = '55000', message = 'LEDGER_UNDO_IMPORTED: this record did not come from this confirmation';
  end if;

  -- 그 확정이 만든 연결 행(새 기록이면 그 기록의 연결 전부여야 한다).
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_rs from public.app_ledger_record_sources x
    where x.record_id = r.id and x.created_at = v_at;
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_links from public.app_ledger_links x
    where x.record_id = r.id and x.created_at = v_at;

  if c.action in ('new', 'supersede') then
    if exists (select 1 from public.app_ledger_links x where x.target_record_id = r.id)
       or exists (select 1 from public.app_ledger_records x
         where x.superseded_by = r.id and (c.action <> 'supersede' or x.id <> c.target_record_id))
       or exists (select 1 from public.app_ledger_candidates x
         where x.id <> c.id and x.status <> 'discarded' and (x.target_record_id = r.id or x.result_record_id = r.id)) then
      raise exception using errcode = '55000', message = 'LEDGER_UNDO_REFERENCED: another record or candidate points to this record';
    end if;
    if r.updated_at <> r.created_at
       or exists (select 1 from public.app_ledger_record_sources x where x.record_id = r.id and x.created_at <> v_at)
       or exists (select 1 from public.app_ledger_links x where x.record_id = r.id and x.created_at <> v_at) then
      raise exception using errcode = '55000', message = 'LEDGER_UNDO_RECORD_CHANGED: the record was edited after confirmation';
    end if;
  end if;
  -- 그 확정이 만든 연결이 확정 뒤 고쳐졌거나 지워졌으면 거절(감사 기록으로 판단).
  if exists (select 1 from public.app_ledger_audit a
       where a.workspace_id = c.workspace_id and a.created_at > v_at and a.target_table in ('record_sources', 'links')
         and (a.target_id = any (v_rs) or a.target_id = any (v_links)
           or (a.event = 'row_delete' and a.detail -> 'before' ->> 'record_id' = r.id::text
               and (a.detail -> 'before' ->> 'created_at')::timestamptz = v_at))) then
    raise exception using errcode = '55000', message = 'LEDGER_UNDO_RECORD_CHANGED: a source or link of this confirmation was edited';
  end if;

  -- 대체였으면: 대체된 기록이 아직 이 기록으로 대체돼 있고 확정 뒤 고친 적이 없어야 한다. 확정 직전 값은 그 확정의 감사 기록에 있다.
  if c.action = 'supersede' then
    select a.detail -> 'before' into v_before from public.app_ledger_audit a
      where a.workspace_id = c.workspace_id and a.event = 'row_update' and a.target_table = 'records'
        and a.target_id = c.target_record_id and a.created_at = v_at and a.detail -> 'before' ? 'superseded_by'
      order by a.id limit 1;
    if v_before is null
       or not exists (select 1 from public.app_ledger_records x
         where x.id = c.target_record_id and x.workspace_id = c.workspace_id and x.superseded_by = r.id and x.validity = 'superseded')
       or exists (select 1 from public.app_ledger_audit a
         where a.workspace_id = c.workspace_id and a.target_table = 'records' and a.target_id = c.target_record_id and a.created_at > v_at) then
      raise exception using errcode = '55000', message = 'LEDGER_UNDO_TARGET_CHANGED: the replaced record was edited after confirmation';
    end if;
  end if;

  -- 감사 기록 먼저(후보 잠금 트리거가 이 행을 보고 "확정 → 대기"를 허용한다).
  insert into public.app_ledger_audit (workspace_id, event, target_table, target_id, detail)
  values (c.workspace_id, 'note', 'candidates', c.id, pg_catalog.jsonb_build_object('action', 'candidate_unconfirm',
    'candidate_action', c.action, 'record_id', r.id, 'ledger_id', r.ledger_id, 'confirmed_at', v_at));

  -- 그 확정이 새로 만든 출처(연결을 떼기 전에 모아 둔다).
  select coalesce(pg_catalog.array_agg(distinct s.id), '{}') into v_src from public.app_ledger_sources s
    join public.app_ledger_record_sources x on x.source_id = s.id
    where x.id = any (v_rs) and s.created_at = v_at and s.import_id is null;

  delete from public.app_ledger_record_sources where id = any (v_rs);
  get diagnostics v_unlinked = row_count;
  delete from public.app_ledger_links where id = any (v_links);
  get diagnostics v_removed = row_count;

  update public.app_ledger_sources s set status = 'retired'
    where s.id = any (v_src) and s.status = 'active' and s.updated_at = s.created_at
      and not exists (select 1 from public.app_ledger_record_sources x where x.source_id = s.id);
  get diagnostics v_retired_sources = row_count;

  if c.action = 'supersede' then
    update public.app_ledger_records
      set validity = coalesce(v_before ->> 'validity', 'current'), superseded_by = null,
          supersede_reason = case when v_before ? 'supersede_reason' then v_before ->> 'supersede_reason' else supersede_reason end
      where id = c.target_record_id and workspace_id = c.workspace_id and superseded_by = r.id;
    v_restored := true;
  end if;
  if c.action in ('new', 'supersede') then
    update public.app_ledger_records set validity = 'retired' where id = r.id and workspace_id = c.workspace_id;
  end if;

  begin
    update public.app_ledger_candidates
      set status = 'pending', result_record_id = null, decided_at = null
      where id = c.id and status = 'confirmed';
  exception
    when unique_violation then
      raise exception using errcode = '23505',
        message = 'LEDGER_UNDO_DUPLICATE_PENDING: another pending candidate has the same dedup key';
  end;

  return pg_catalog.jsonb_build_object('candidate_id', c.id, 'status', 'pending', 'action', c.action, 'record_id', r.id,
    'ledger_id', r.ledger_id, 'record_retired', c.action in ('new', 'supersede'), 'target_restored', v_restored,
    'sources_unlinked', v_unlinked, 'links_removed', v_removed, 'sources_retired', v_retired_sources);
end;
$$;

revoke all on function private.app_guard_ledger_candidate() from public, anon, authenticated, service_role;
revoke all on function public.app_unconfirm_ledger_candidate(uuid) from public, anon, service_role;
grant execute on function public.app_unconfirm_ledger_candidate(uuid) to authenticated;

-- 같은 이름의 후보 잠금 트리거를 새 함수로 바꾼다(끄는 순간 없음, 같은 거래).
create or replace trigger app_ledger_candidates_guard before update on public.app_ledger_candidates
  for each row execute function private.app_guard_ledger_candidate();

-- 사후 확인: 새 함수 2개 INVOKER·search_path 빈칸, 되돌리기 함수는 authenticated만, 잠금 함수는 직접 실행 권한 없음,
-- 후보 잠금 트리거가 새 함수를 쓰고 켜져 있음, 가져오기 묶음 잠금은 그대로.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname in ('app_unconfirm_ledger_candidate', 'app_guard_ledger_candidate')
          and not p.prosecdef and p.proconfig = array['search_path=""']
          and p.proacl is not null and p.proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 2
     or not exists (select 1 from pg_trigger t
        where t.tgrelid = 'public.app_ledger_candidates'::regclass and t.tgname = 'app_ledger_candidates_guard'
          and t.tgfoid = 'private.app_guard_ledger_candidate()'::regprocedure and t.tgenabled = 'O')
     or not exists (select 1 from pg_trigger t
        where t.tgrelid = 'public.app_ledger_imports'::regclass and t.tgname = 'app_ledger_imports_guard'
          and t.tgfoid = 'private.app_ledger_decided_guard()'::regprocedure and t.tgenabled = 'O') then
    raise exception 'LEDGER_UNDO_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021234000', 'ledger_candidate_undo', array['LEDGER-undo: app_unconfirm_ledger_candidate (one transaction: remove the confirmation links, retire the new record, restore a superseded target, candidate back to pending; audit note); candidate guard trigger allows confirmed -> pending only from that function; SECURITY INVOKER, authenticated only']);
commit;
