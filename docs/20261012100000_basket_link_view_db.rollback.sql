begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

-- STOP until the owner has exported and verified every non-null summary,
-- then explicitly cleared those values using the documented recovery steps.
-- Never silently drop approved text. This guard is inside the same transaction.
do $guard$
begin
  if exists(select 1 from public.app_record_links where summary is not null) then
    raise exception 'SUMMARY_BACKUP_REQUIRED: export, verify and clear summaries before rollback';
  end if;
end;
$guard$;

drop function public.app_basket_update_link_summary(uuid,text,text);
-- Restore the exact 4a definition; keep its execution ACL and all existing links.
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
    if (select count(*) from pg_catalog.jsonb_object_keys(v_target)) <> 3
       or not (v_target ?& array['kind','target_id','reason'])
       or pg_catalog.jsonb_typeof(v_target->'kind') <> 'string'
       or (v_target->>'kind') not in ('organization','project')
       or pg_catalog.jsonb_typeof(v_target->'target_id') <> 'string'
       or (v_target->>'target_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(v_target->'reason') <> 'string'
       or pg_catalog.length(v_target->>'reason') not between 1 and 2000 then
      return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS','created',0,'existing',0);
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
    insert into public.app_record_links(workspace_id,note_id,organization_id,project_id,status,report_kind)
    values(v_note.workspace_id,p_note_id,
      case when v_target->>'kind'='organization' then v_id else null end,
      case when v_target->>'kind'='project' then v_id else null end,
      'confirmed',case when v_target->>'kind'='organization' then 'organization' else 'business' end)
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
alter table public.app_record_links drop constraint app_record_links_summary_check;
alter table public.app_record_links drop column summary;
delete from supabase_migrations.schema_migrations where version='20261012100000' and name='basket_link_view_db';
commit;
