begin;
-- REF-참고묶음 1단계 DB (docs/design/ref-bundle.md 2·7절, 명진 결정 2026-10-23 23:07). 앱 코드 변경 없음. 적용은 커맨드센터가
-- docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
-- 선행: 20261023023500 bizreport_meeting_links 적용 완료(연결 표의 출처·중복 규칙이 그 모양일 때만 진행, 아니면 사전 확인에서 멈춤).
--
-- 무엇:
--   1) 새 표 app_reference_bundles(참고 묶음 이름·순서). 소유자만 읽고 쓴다(private.app_is_workspace_owner). anon·PUBLIC 권한 없음.
--      이름 1~30자, 같은 업무공간 안에서 이름 중복 불가.
--      처음 묶음 3개(공공운수노조 10 / 공공기관사업(본부) 20 / 기타 조직 30)를 업무공간마다 한 번 넣는다(이미 있으면 건너뜀).
--      이 표의 새 행 추가·이름 바꾸기·순서는 앱이 한다. 처음 3개는 설계 2.2절대로 migration이 채운다(앱이 처음 열 때 채우는 길은 쓰지 않는다).
--   2) 연결 표(app_record_links)에 도착 칸 bundle_id. 도착지는 여전히 정확히 하나(조직·프로젝트·회의·문서·참고 묶음 중).
--      참고 연결은 메모·노트 출처 + 확정 상태 + report_kind 비움(= 보고용 아님)만 받는다.
--      묶음이 붙어 있으면 DB가 그 묶음을 못 지우게 한다(on delete restrict = 빈 묶음만 지우기).
--      같은 업무공간 확인: 기존 소유자 정책은 고치지 않고 좁히기 전용(restrictive) 정책 하나만 더한다.
--   3) 저장 함수 2개를 같은 서명으로 넓힌다(새 함수 없음, INVOKER·search_path 고정·authenticated만 실행):
--      app_basket_confirm_links: kind 'reference' 추가(묶음이 메모와 같은 업무공간일 때만, 보고용 칸 비움).
--      app_basket_update_link_summary: 참고 연결에도 요약을 붙이고 고칠 수 있게.
-- 권한: 기존 표 권한·기존 정책·RLS 켜짐·트리거 변경 없음. 새 표 권한은 authenticated만(읽기 전체, 넣기 3칸, 고치기 3칸, 지우기).
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 참고 연결 줄이 하나라도 있으면 멈춘다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_links in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023231500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261023023500' and name = 'bizreport_meeting_links') <> 1
     or to_regclass('public.app_record_links') is null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_reference_bundles') is not null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_record_links'::regclass and not attisdropped and attname = 'bundle_id')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_record_links'::regclass
         and conname in ('app_record_links_bundle_id_fkey', 'app_record_links_one_target_bundle',
           'app_record_links_unique_bundle', 'app_record_links_bundle_shape'))
     or exists (select 1 from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_bundle_ws')
     or exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'app_record_links_bundle_idx')
     -- 출처·중복·도착지 규칙이 저장소의 마지막 모양(20261023023500)일 때만. 되돌리기가 이 모양으로 돌려놓는다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_source'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g') = 'CHECKnum_nonnullsgoogle_task_id,note_id,source_meeting_id=1') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_unique'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_target'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id=1') <> 1
     -- 연결 표: RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 소유자 정책 + 회의 좁히기 정책 둘뿐.
     or exists (select 1 from pg_class where oid = 'public.app_record_links'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_source_meeting_ws'
         and not polpermissive) <> 1
     -- 넓힐 함수 둘: 지금 본문이 저장소(20261012100000)와 같고, INVOKER·search_path 고정, anon·PUBLIC 실행권 없음, authenticated 실행 가능.
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)')
         and not prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = 'd668d59c4a495730dfb93dcca8f73304'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)')
         and not prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = '91ae418dace64f47a48deff88a65074f'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1 then
    raise exception 'REF_BUNDLE_DB_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 참고 묶음 표.
create table public.app_reference_bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_reference_bundles_name_check check (char_length(btrim(name)) between 1 and 30),
  constraint app_reference_bundles_name_unique unique (workspace_id, name)
);
alter table public.app_reference_bundles enable row level security;
revoke all on table public.app_reference_bundles from public, anon, authenticated, service_role;
grant select, delete on table public.app_reference_bundles to authenticated;
grant insert (workspace_id, name, sort_order) on table public.app_reference_bundles to authenticated;
grant update (name, sort_order, updated_at) on table public.app_reference_bundles to authenticated;
create policy reference_bundles_owner_all on public.app_reference_bundles for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 처음 묶음 3개: 업무공간마다 한 번(같은 이름이 있으면 건너뜀). 일반 명칭이라 공개 저장소에 써도 된다.
insert into public.app_reference_bundles(workspace_id, name, sort_order)
select w.id, b.name, b.sort_order
  from public.app_workspaces w
  cross join (values ('공공운수노조', 10), ('공공기관사업(본부)', 20), ('기타 조직', 30)) as b(name, sort_order)
on conflict on constraint app_reference_bundles_name_unique do nothing;

-- 2) 연결 표 도착 칸. 새 제약을 먼저 만들고 옛 제약을 지운 뒤 같은 이름으로 바꾼다(기존 방식, app_basket_confirm_links가 unique 이름을 쓴다).
alter table public.app_record_links
  add column bundle_id uuid
    constraint app_record_links_bundle_id_fkey references public.app_reference_bundles(id) on delete restrict;
alter table public.app_record_links
  add constraint app_record_links_one_target_bundle
    check (num_nonnulls(project_id, organization_id, meeting_id, document_id, bundle_id) = 1),
  add constraint app_record_links_unique_bundle unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id, document_id, source_meeting_id, bundle_id),
  add constraint app_record_links_bundle_shape
    check (bundle_id is null or (note_id is not null and status = 'confirmed' and report_kind is null));
alter table public.app_record_links
  drop constraint app_record_links_one_target,
  drop constraint app_record_links_unique;
alter table public.app_record_links rename constraint app_record_links_one_target_bundle to app_record_links_one_target;
alter table public.app_record_links rename constraint app_record_links_unique_bundle to app_record_links_unique;
create index app_record_links_bundle_idx on public.app_record_links(bundle_id) where bundle_id is not null;

-- 같은 업무공간 확인: 좁히기 전용. 기존 소유자 정책과 함께(AND) 적용된다. 남의 묶음은 소유자 RLS 때문에 보이지 않으므로 거절된다.
create policy record_links_bundle_ws on public.app_record_links as restrictive
  for all to authenticated
  using (bundle_id is null or exists (select 1 from public.app_reference_bundles b
    where b.id = app_record_links.bundle_id and b.workspace_id = app_record_links.workspace_id))
  with check (bundle_id is null or exists (select 1 from public.app_reference_bundles b
    where b.id = app_record_links.bundle_id and b.workspace_id = app_record_links.workspace_id));

-- 3) 저장 함수 2개(같은 서명, 본문 교체). 실행권은 그대로: PUBLIC·anon 회수, authenticated만.
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
    insert into public.app_record_links(workspace_id,note_id,organization_id,project_id,bundle_id,status,report_kind,summary)
    values(v_note.workspace_id,p_note_id,
      case when v_target->>'kind'='organization' then v_id else null end,
      case when v_target->>'kind'='project' then v_id else null end,
      case when v_target->>'kind'='reference' then v_id else null end,
      'confirmed',case when v_target->>'kind'='organization' then 'organization' when v_target->>'kind'='reference' then null else 'business' end,v_target->>'summary')
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
      and pg_catalog.num_nonnulls(l.organization_id,l.project_id,l.bundle_id)=1;
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
     or pg_catalog.num_nonnulls(v_link.organization_id,v_link.project_id,v_link.bundle_id) <> 1 then
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
  elsif v_link.bundle_id is not null then
    select b.workspace_id into v_workspace from public.app_reference_bundles b
      where b.id=v_link.bundle_id for share;
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

-- 사후 확인: 표·권한·정책·칸·제약 모양·함수 본문/권한·처음 묶음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_reference_bundles'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or exists (select 1 from pg_attribute where attrelid = 'public.app_reference_bundles'::regclass
         and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_reference_bundles', 'truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = 'public.app_reference_bundles'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_reference_bundles'::regclass and polname = 'reference_bundles_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_record_links'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 3
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_bundle_ws'
         and not polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_bundle_id_fkey'
         and contype = 'f' and confrelid = 'public.app_reference_bundles'::regclass and confdeltype = 'r' and array_length(conkey, 1) = 1) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_target'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id,bundle_id=1') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_unique'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id,bundle_id') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_bundle_shape') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%app_reference_bundles%'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%app_reference_bundles%'
         and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated', oid, 'execute')) <> 1
     or exists (select 1 from public.app_workspaces w where (select count(*) from public.app_reference_bundles b
         where b.workspace_id = w.id and ((b.name = '공공운수노조' and b.sort_order = 10) or (b.name = '공공기관사업(본부)' and b.sort_order = 20)
           or (b.name = '기타 조직' and b.sort_order = 30))) <> 3)
     or exists (select 1 from public.app_record_links where bundle_id is not null) then
    raise exception 'REF_BUNDLE_DB_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023231500', 'ref_bundle_db', array['REF-참고묶음 DB: app_reference_bundles (owner RLS, 3 starter bundles per workspace) + app_record_links.bundle_id (one_target/unique widened, bundle_shape, restrictive workspace policy, on delete restrict) + app_basket_confirm_links/app_basket_update_link_summary accept reference (INVOKER)']);
commit;
