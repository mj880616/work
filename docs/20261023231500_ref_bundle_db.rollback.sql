begin;
-- 20261023231500_ref_bundle_db의 짝 되돌리기(SQL Editor 경로 전용: drop policy·표 삭제·함수 본문 복원은 workflow rollback 허용 목록 밖).
-- 참고 연결 줄(bundle_id가 있는 줄)이 하나라도 있으면 멈춘다. 그때는 아래 순서로 한다:
--   1) docs/20261023231500_ref_bundle_db.preserve.sql을 SQL Editor에서 실행해 결과(묶음 이름·순서 + 참고 연결 줄)를 보관한다.
--   2) 명진 확인 뒤, 참고 연결 줄 삭제(delete from public.app_record_links where bundle_id is not null)를 따로 승인받아 실행한다.
--   3) 그 다음에 이 파일을 실행한다.
-- 순서: 함수 2개를 이전 본문으로 복원 → 좁히기 정책 삭제 → 도착지·중복 규칙을 옛 모양(같은 이름)으로 → 모양 검사·색인·bundle_id 칸 삭제
--   → 묶음 표 삭제(사용자가 더하거나 이름을 바꾼 묶음도 함께 사라진다: preserve 결과 보관) → 기록 1행 삭제.
-- 업데이트 원문(app_notes)·다른 연결 줄·기존 정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023231500' and name = 'ref_bundle_db') <> 1 then
    raise exception 'REF_BUNDLE_DB_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_record_links where bundle_id is not null) then
    raise exception 'REF_BUNDLE_DB_ROLLBACK_BLOCKED: reference links exist; preserve and delete them first with separate approval';
  end if;
end
$$;

-- 이전 본문(20261012100000)으로 복원. 실행권(authenticated만)은 그대로 유지된다.
create or replace function public.app_basket_confirm_links(
  p_note_id uuid, p_note_updated_at timestamptz, p_targets jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $basket$
declare
  v_note public.app_notes%rowtype;
  v_target jsonb;
  v_id uuid;
  v_space public.app_spaces%rowtype;
  v_workspace uuid;
  v_cursor uuid;
  v_path uuid[];
  v_project boolean;
  v_archived boolean;
  v_selected_archived boolean;
  v_management jsonb;
  v_version_text text;
  v_version_two boolean;
  v_inserted uuid;
  v_status text;
  v_created integer := 0;
  v_existing integer := 0;
begin
  if p_note_id is null or p_note_updated_at is null or not pg_catalog.isfinite(p_note_updated_at) then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_INPUT','created',0,'existing',0);
  end if;
  -- INVOKER: invisible notes cannot be locked or used to infer another owner's data.
  select n.* into v_note from public.app_notes n where n.id = p_note_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOTE_MISSING','created',0,'existing',0);
  end if;
  if v_note.updated_at <> p_note_updated_at then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOTE_CHANGED','created',0,'existing',0);
  end if;
  if v_note.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOTE_ARCHIVED','created',0,'existing',0);
  end if;
  if v_note.ai_export_allowed is not true then
    return pg_catalog.jsonb_build_object('ok',false,'error','AI_EXCLUDED','created',0,'existing',0);
  end if;
  if p_targets is null or pg_catalog.jsonb_typeof(p_targets) <> 'array'
     or pg_catalog.octet_length(p_targets::text) > 1048576 then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
  end if;
  if pg_catalog.jsonb_array_length(p_targets) not between 1 and 20 then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
  end if;
  -- Validate and lock every destination before making the first insert. A single
  -- rejected destination refuses this whole note, without partial confirmation.
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    if pg_catalog.jsonb_typeof(v_target) <> 'object' then
      return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
    end if;
    if exists(select 1 from pg_catalog.jsonb_object_keys(v_target) k where k not in ('kind','target_id','reason','summary'))
       or not (v_target ?& array['kind','target_id','reason'])
       or pg_catalog.jsonb_typeof(v_target->'kind') <> 'string'
       or (v_target->>'kind') not in ('organization','project')
       or pg_catalog.jsonb_typeof(v_target->'target_id') <> 'string'
       or (v_target->>'target_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(v_target->'reason') <> 'string'
       or pg_catalog.length(v_target->>'reason') not between 1 and 2000 then
      return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
    end if;
    -- Missing/JSON null summaries stay SQL NULL; reason is never promoted.
    if v_target ? 'summary' and v_target->'summary' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_target->'summary') <> 'string'
         or not (pg_catalog.length(v_target->>'summary') between 1 and 2000 and pg_catalog.length(pg_catalog.btrim(v_target->>'summary', E' \t\n\r\f\v' || pg_catalog.chr(133) || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279))) > 0) then
        return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
      end if;
    end if;
    v_id := (v_target->>'target_id')::uuid;
    if v_target->>'kind' = 'organization' then
      select o.workspace_id into v_workspace from public.app_suborganizations o where o.id = v_id for share;
      if not found then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING','created',0,'existing',0);
      end if;
      if v_workspace <> v_note.workspace_id then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_WORKSPACE','created',0,'existing',0);
      end if;
    else
      -- Match project-catalog.select/tree: v2 project or its descendant, with
      -- no archived ancestor. Lock ancestors against archive during confirmation.
      v_cursor := v_id; v_path := array[]::uuid[]; v_project := false;
      v_archived := false; v_selected_archived := false;
      while v_cursor is not null loop
        if v_cursor = any(v_path) then
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE','created',0,'existing',0);
        end if;
        select s.* into v_space from public.app_spaces s where s.id = v_cursor for share;
        if not found then
          if v_cursor = v_id then
            return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING','created',0,'existing',0);
          end if;
          exit;
        end if;
        if v_space.workspace_id <> v_note.workspace_id then
          if v_cursor <> v_id then exit; end if;
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_WORKSPACE','created',0,'existing',0);
        end if;
        if v_space.owner_id is distinct from auth.uid() then
          if v_cursor <> v_id then exit; end if;
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE','created',0,'existing',0);
        end if;
        v_archived := v_archived or coalesce(v_space.status = 'archived',false);
        -- Canonical catalog also recognizes Number(management_version)=2.
        -- JSON singleton arrays coerce through their single scalar string.
        v_management := v_space.metadata->'management_version';
        while pg_catalog.jsonb_typeof(v_management) = 'array' loop
          if pg_catalog.jsonb_array_length(v_management) <> 1 then exit; end if;
          v_management := v_management->0;
        end loop;
        v_version_two := false;
        if pg_catalog.jsonb_typeof(v_management) in ('number','string') then
          v_version_text := pg_catalog.btrim(v_management #>> '{}', E' \t\n\r\f\v' || pg_catalog.chr(160) || pg_catalog.chr(65279) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288));
          if v_version_text ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
            begin
              v_version_two := v_version_text::double precision = 2;
            exception when numeric_value_out_of_range then v_version_two := false;
            end;
          else
            v_version_two := v_version_text ~ '^0[xX]0*2$|^0[oO]0*2$|^0[bB]0*10$';
          end if;
        end if;
        if coalesce(v_space.metadata->>'project_system' = 'v2',false) or v_version_two then
          v_project := true;
          -- Only ancestors in catalog.select are relevant. A legacy parent
          -- above the highest v2 ancestor is excluded, so this node is a root.
          v_selected_archived := v_archived;
        end if;
        v_path := pg_catalog.array_append(v_path,v_cursor); v_cursor := v_space.parent_id;
      end loop;
      if not v_project or v_selected_archived then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE','created',0,'existing',0);
      end if;
    end if;
    if exists(select 1 from public.app_record_links l where l.note_id=p_note_id and l.status='suggested'
       and ((v_target->>'kind'='organization' and l.organization_id=v_id)
         or (v_target->>'kind'='project' and l.project_id=v_id))) then
      return pg_catalog.jsonb_build_object('ok',false,'error','SUGGESTED_EXISTS','created',0,'existing',0);
    end if;
  end loop;
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    v_id := (v_target->>'target_id')::uuid;
    v_inserted := null;
    insert into public.app_record_links(workspace_id,note_id,organization_id,project_id,status,report_kind,summary)
    values(v_note.workspace_id,p_note_id,
      case when v_target->>'kind'='organization' then v_id else null end,
      case when v_target->>'kind'='project' then v_id else null end,
      'confirmed',case when v_target->>'kind'='organization' then 'organization' else 'business' end,v_target->>'summary')
    on conflict on constraint app_record_links_unique do nothing returning id into v_inserted;
    if v_inserted is not null then v_created := v_created + 1;
    else
      select l.status into v_status from public.app_record_links l where l.note_id=p_note_id
        and ((v_target->>'kind'='organization' and l.organization_id=v_id)
          or (v_target->>'kind'='project' and l.project_id=v_id));
      if v_status is distinct from 'confirmed' then
        raise exception using errcode='P0001', message='SUGGESTED_EXISTS';
      end if;
      v_existing := v_existing + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('ok',true,'created',v_created,'existing',v_existing);
exception
  -- The exception block rolls back ALL inserts for this note before returning.
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED','created',0,'existing',0);
  when foreign_key_violation then
    return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING','created',0,'existing',0);
  when raise_exception then
    if sqlerrm <> 'SUGGESTED_EXISTS' then raise; end if;
    return pg_catalog.jsonb_build_object('ok',false,'error','SUGGESTED_EXISTS','created',0,'existing',0);
end;
$basket$;
revoke all on function public.app_basket_confirm_links(uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.app_basket_confirm_links(uuid,timestamptz,jsonb) to authenticated;

create or replace function public.app_basket_update_link_summary(
  p_link_id uuid, p_expected_summary text, p_summary text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $summary$
declare
  v_link public.app_record_links%rowtype;
  v_note public.app_notes%rowtype;
  v_note_id uuid;
  v_workspace uuid;
  v_owner uuid;
begin
  if auth.uid() is null then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
  end if;
  if p_link_id is null or p_summary is null
     or not (pg_catalog.length(p_summary) between 1 and 2000 and pg_catalog.length(pg_catalog.btrim(p_summary, E' \t\n\r\f\v' || pg_catalog.chr(133) || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279))) > 0)
     or (p_expected_summary is not null and not (pg_catalog.length(p_expected_summary) between 1 and 2000 and pg_catalog.length(pg_catalog.btrim(p_expected_summary, E' \t\n\r\f\v' || pg_catalog.chr(133) || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279))) > 0)) then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_INPUT');
  end if;
  -- Read via invoker RLS; hidden rows and absent rows share NOT_FOUND.
  select l.note_id into v_note_id from public.app_record_links l
    where l.id=p_link_id and l.note_id is not null and l.google_task_id is null
      and l.status='confirmed' and l.meeting_id is null and l.document_id is null
      and pg_catalog.num_nonnulls(l.organization_id,l.project_id)=1;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
  end if;
  -- Same lock order as confirmation: note, then link, then target. Re-read the
  -- link after waiting, so a concurrently moved/deleted link cannot be edited.
  select n.* into v_note from public.app_notes n where n.id=v_note_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
  end if;
  select l.* into v_link from public.app_record_links l where l.id=p_link_id for update;
  if not found then
    -- UPDATE RLS may hide a row that SELECT RLS still allows. Report permission
    -- refusal without exposing any row invisible through SELECT.
    if exists(select 1 from public.app_record_links l where l.id=p_link_id) then
      return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
    end if;
    return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
  end if;
  if v_link.note_id is distinct from v_note_id
     or v_link.google_task_id is not null or v_link.status <> 'confirmed'
     or v_link.meeting_id is not null or v_link.document_id is not null
     or pg_catalog.num_nonnulls(v_link.organization_id,v_link.project_id) <> 1 then
    return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
  end if;
  if v_link.workspace_id is distinct from v_note.workspace_id
     or not private.app_is_workspace_owner(v_link.workspace_id)
     or not private.app_is_workspace_owner(v_note.workspace_id) then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
  end if;
  if v_link.organization_id is not null then
    select o.workspace_id into v_workspace from public.app_suborganizations o
      where o.id=v_link.organization_id for share;
    if not found then
      return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
    end if;
  else
    select s.workspace_id,s.owner_id into v_workspace,v_owner from public.app_spaces s
      where s.id=v_link.project_id for share;
    if not found then
      return pg_catalog.jsonb_build_object('ok',false,'error','NOT_FOUND');
    end if;
    if v_owner is distinct from auth.uid() then
      return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
    end if;
  end if;
  if v_workspace is distinct from v_link.workspace_id
     or not private.app_is_workspace_owner(v_workspace) then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
  end if;
  if v_link.summary is distinct from p_expected_summary then
    return pg_catalog.jsonb_build_object('ok',false,'error','SUMMARY_CHANGED');
  end if;
  update public.app_record_links set summary=p_summary
    where id=p_link_id and summary is not distinct from p_expected_summary;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
  end if;
  return pg_catalog.jsonb_build_object('ok',true);
exception when insufficient_privilege then
  return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
end;
$summary$;
revoke all on function public.app_basket_update_link_summary(uuid,text,text) from public, anon;
grant execute on function public.app_basket_update_link_summary(uuid,text,text) to authenticated;

drop policy record_links_bundle_ws on public.app_record_links;

alter table public.app_record_links
  add constraint app_record_links_one_target_prev
    check (num_nonnulls(project_id, organization_id, meeting_id, document_id) = 1),
  add constraint app_record_links_unique_prev unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id, document_id, source_meeting_id);
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique,
  drop constraint app_record_links_bundle_shape;
alter table public.app_record_links rename constraint app_record_links_one_target_prev to app_record_links_one_target;
alter table public.app_record_links rename constraint app_record_links_unique_prev to app_record_links_unique;
drop index public.app_record_links_bundle_idx;
alter table public.app_record_links drop column bundle_id;
drop table public.app_reference_bundles;

delete from supabase_migrations.schema_migrations
  where version = '20261023231500' and name = 'ref_bundle_db';
commit;
