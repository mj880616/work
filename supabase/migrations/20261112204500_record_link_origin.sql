begin;
-- ORG-기록첨부표시이름 ① DB (S61-6, 커맨드센터 결정 B안). 앱 코드 변경 없음. 적용은 커맨드센터가
-- docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 운영 적용 직전 정지.
-- 선행: 20261023231500 ref_bundle_db 적용 완료(연결 저장 함수 본문이 그 모양일 때만 진행, 아니면 사전 확인에서 멈춤).
--
-- 무엇:
--   1) 연결 표(app_record_links)에 '만든 곳' 칸 origin(text, 빈칸 가능). 값은 'record_input'(조직·사업 보고 기록 입력칸에서 바로 올림)
--      또는 'basket'(잊지 말기에서 옮김)만, 메모·노트 출처(note_id) 연결에만. 지난 줄은 빈칸 그대로(채우지 않음 — 화면은 빈칸을 '잊지 말기 연결'로 본다).
--   2) 저장 함수 app_basket_confirm_links를 같은 서명으로 넓힌다: 대상마다 origin을 받아 새 줄에 저장(이미 있는 줄은 그대로).
--      INVOKER·search_path 고정·authenticated만 실행 — 지금과 같다. 다른 검사(소유자·같은 업무공간·도착지)는 한 글자도 바꾸지 않는다.
-- 권한: 표 권한·정책·RLS 켜짐·트리거·함수 실행권 변경 없음(표 단위 권한이라 새 칸도 지금 권한 그대로, 소유자 RLS 아래).
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 함수를 이전 본문으로 되돌리고 칸·제약을 지운다. 저장된 '만든 곳' 표시는 함께 없어진다(기록·연결 자체는 그대로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261112204500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261023231500' and name = 'ref_bundle_db') <> 1
     or to_regclass('public.app_record_links') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_record_links'::regclass and not attisdropped and attname = 'origin')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_origin_check')
     -- 연결 표: RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책 셋(소유자·회의 좁히기·묶음 좁히기) 그대로.
     or exists (select 1 from pg_class where oid = 'public.app_record_links'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 3
     -- 넓힐 함수: 지금 본문이 저장소(20261023231500)와 같고, INVOKER·search_path 고정, anon·PUBLIC 실행권 없음, authenticated 실행 가능.
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)')
         and not prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = '09b630287dc131bff594407893c58d0f'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1 then
    raise exception 'RECORD_LINK_ORIGIN_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 만든 곳 칸. 지난 줄은 빈칸(채우지 않는다).
alter table public.app_record_links
  add column origin text,
  add constraint app_record_links_origin_check
    check (origin is null or (origin in ('record_input', 'basket') and note_id is not null));

-- 2) 저장 함수(같은 서명, 본문 교체). 실행권은 그대로: PUBLIC·anon 회수, authenticated만.
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
    if exists(select 1 from pg_catalog.jsonb_object_keys(v_target) k where k not in ('kind','target_id','reason','summary','origin'))
       or not (v_target ?& array['kind','target_id','reason'])
       or pg_catalog.jsonb_typeof(v_target->'kind') <> 'string'
       or (v_target->>'kind') not in ('organization','project','reference')
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
    -- 만든 곳 표시(ORG-기록첨부표시이름 ①): 없거나 JSON null이면 SQL NULL(지난 길과 같음). 값은 정해진 두 글자만.
    if v_target ? 'origin' and v_target->'origin' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_target->'origin') <> 'string'
         or (v_target->>'origin') not in ('record_input','basket') then
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
    elsif v_target->>'kind' = 'reference' then
      -- 참고 묶음: 메모와 같은 업무공간의 묶음만(소유자 RLS 아래에서 읽으므로 남의 묶음은 보이지 않아 TARGET_MISSING).
      select b.workspace_id into v_workspace from public.app_reference_bundles b where b.id = v_id for share;
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
         or (v_target->>'kind'='project' and l.project_id=v_id)
         or (v_target->>'kind'='reference' and l.bundle_id=v_id))) then
      return pg_catalog.jsonb_build_object('ok',false,'error','SUGGESTED_EXISTS','created',0,'existing',0);
    end if;
  end loop;
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    v_id := (v_target->>'target_id')::uuid;
    v_inserted := null;
    insert into public.app_record_links(workspace_id,note_id,organization_id,project_id,bundle_id,status,report_kind,summary,origin)
    values(v_note.workspace_id,p_note_id,
      case when v_target->>'kind'='organization' then v_id else null end,
      case when v_target->>'kind'='project' then v_id else null end,
      case when v_target->>'kind'='reference' then v_id else null end,
      'confirmed',case when v_target->>'kind'='organization' then 'organization' when v_target->>'kind'='reference' then null else 'business' end,v_target->>'summary',
      case when v_target ? 'origin' and v_target->'origin' <> 'null'::jsonb then v_target->>'origin' else null end)
    on conflict on constraint app_record_links_unique do nothing returning id into v_inserted;
    if v_inserted is not null then v_created := v_created + 1;
    else
      select l.status into v_status from public.app_record_links l where l.note_id=p_note_id
        and ((v_target->>'kind'='organization' and l.organization_id=v_id)
          or (v_target->>'kind'='project' and l.project_id=v_id)
          or (v_target->>'kind'='reference' and l.bundle_id=v_id));
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

-- 사후 확인: 칸·제약·정책 수·RLS·함수 본문/권한·지난 줄 빈칸. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_record_links'::regclass and not attisdropped
         and attname = 'origin' and atttypid = 'text'::regtype and not attnotnull and not atthasdef) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_origin_check'
         and contype = 'c') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_record_links'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 3
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%record_input%'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1
     or exists (select 1 from public.app_record_links where origin is not null) then
    raise exception 'RECORD_LINK_ORIGIN_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261112204500', 'record_link_origin', array['ORG-기록첨부표시이름 ①: app_record_links.origin (null | record_input | basket, note links only; old rows stay null) + app_basket_confirm_links stores target origin (INVOKER, same grants)']);
commit;
