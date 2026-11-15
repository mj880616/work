begin;
-- MTG-사업보고 5단계 DB-2 + MEET-기록보내기 B1(합침, docs/design/business-report.md 4.2·7.3·7.4·8절, 결정 9).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 설계 8절 2단계(basket-data.js가 app_meetings!app_record_links_meeting_id_fkey로 읽음) merge·배포 확인 뒤 적용(7.3절).
--   연결 표에서 회의로 가는 길이 둘이 되면 이름 없는 읽기는 PostgREST 모호성 오류가 난다. 그래서 운영 FK 이름이
--   app_record_links_meeting_id_fkey가 아니면 아래 사전 확인에서 멈춘다.
--
-- 무엇:
--   1) 연결 표(app_record_links)에 '출처 회의'(source_meeting_id) 칸. 회의가 지워지면 그 회의의 연결 줄도 지워진다.
--      출처 = 할 일·메모·회의 중 정확히 하나. 회의 출처 줄의 도착지는 조직·프로젝트만, 확정 상태만. 요약은 비어도 된다(= 연결만).
--      중복 규칙(같은 회의 → 같은 곳은 한 줄)에 칸을 더하되 이름은 app_record_links_unique 그대로(app_basket_confirm_links가 이름으로 씀).
--   2) 같은 업무공간 확인: 기존 정책(record_links_owner_all)은 고치지 않고 좁히기 전용(restrictive) 정책 하나를 더한다.
--   3) 저장 함수 app_meeting_set_links: 고른 곳 목록(0~20곳)으로 '그대로 맞추기'(더하기·빼기·요약을 한 번에, 전부 아니면 전무).
--      INVOKER(소유자 RLS를 그대로 따름), search_path 고정, authenticated만 실행. app_meetings.project_id는 '첫 프로젝트'로 함께 맞춘다.
--   4) 기존 project_id가 있는 회의는 같은 곳으로 회의 출처 줄을 한 번 채운다(이미 있으면 건너뜀).
--   5) 장소 칸(사용자 결정 2026-10-23 00:32): app_meetings.location text, 비워도 됨, 200자 이하. 운영에 이미 있으면 더하지 않는다
--      (if not exists). 글자 칸이 아니거나 200자를 넘는 행이 있으면 사전 확인에서 멈춘다. 되돌리기는 장소 칸을 지우지 않는다.
-- 권한: 표 grant·기존 정책·RLS 켜짐·트리거 변경 없음. anon·PUBLIC 권한 없음. 새 함수 실행권은 authenticated만.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings, public.app_record_links in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023023500')
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_record_links') is null
     or to_regprocedure('private.app_meeting_in_workspace(uuid,uuid)') is null
     or to_regprocedure('public.app_meeting_set_links(uuid,timestamptz,jsonb)') is not null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_record_links'::regclass and not attisdropped and attname = 'source_meeting_id')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_record_links'::regclass
         and conname in ('app_record_links_source_meeting_id_fkey', 'app_record_links_one_source_meeting',
           'app_record_links_unique_source_meeting', 'app_record_links_source_meeting_shape'))
     or exists (select 1 from pg_constraint where conrelid = 'public.app_meetings'::regclass and conname = 'app_meetings_location_length_check')
     or exists (select 1 from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_source_meeting_ws')
     -- 연결 표 → 회의 FK는 지금 하나, 이름 app_record_links_meeting_id_fkey(화면 2단계가 이 이름으로 읽는다).
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and contype = 'f'
         and confrelid = 'public.app_meetings'::regclass) <> 1
     or (select count(*) from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.conrelid = 'public.app_record_links'::regclass and c.conname = 'app_record_links_meeting_id_fkey' and c.contype = 'f'
           and c.confrelid = 'public.app_meetings'::regclass and array_length(c.conkey, 1) = 1 and a.attname = 'meeting_id') <> 1
     -- 출처·중복 규칙이 저장소의 마지막 모양(20261010120000)일 때만. 되돌리기가 이 모양으로 돌려놓는다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_source'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g') = 'CHECKnum_nonnullsgoogle_task_id,note_id=1') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_unique'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_target'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id=1') <> 1
     -- 두 표 모두 RLS 켜짐, anon·PUBLIC 표 권한 없음. 연결 표 정책은 record_links_owner_all 하나(소유자만).
     or exists (select 1 from pg_class where oid in ('public.app_meetings'::regclass, 'public.app_record_links'::regclass)
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     -- 함수가 쓰는 회의 칸: updated_at(timestamptz, 버전 비교)·project_id(uuid, 첫 프로젝트).
     or (select count(*) from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and ((attname = 'updated_at' and atttypid = 'timestamptz'::regtype) or (attname = 'project_id' and atttypid = 'uuid'::regtype))) <> 2
     -- 장소 칸: 있으면 글자 칸이어야 하고 200자를 넘는 행이 없어야 한다.
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and attname = 'location'
         and not attisdropped and atttypid <> 'text'::regtype)
     or exists (select 1 from public.app_meetings m where length(to_jsonb(m)->>'location') > 200) then
    raise exception 'BIZREPORT_MEETING_LINKS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 출처 회의 칸과 규칙. 새 제약을 먼저 만들고 옛 제약을 지운 뒤 같은 이름으로 바꾼다(기존 방식).
alter table public.app_record_links
  add column source_meeting_id uuid
    constraint app_record_links_source_meeting_id_fkey references public.app_meetings(id) on delete cascade;
alter table public.app_record_links
  add constraint app_record_links_one_source_meeting
    check (num_nonnulls(google_task_id, note_id, source_meeting_id) = 1),
  add constraint app_record_links_unique_source_meeting unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id, document_id, source_meeting_id),
  add constraint app_record_links_source_meeting_shape
    check (source_meeting_id is null or (meeting_id is null and document_id is null and status = 'confirmed'));
alter table public.app_record_links
  drop constraint app_record_links_one_source,
  drop constraint app_record_links_unique;
alter table public.app_record_links rename constraint app_record_links_one_source_meeting to app_record_links_one_source;
alter table public.app_record_links rename constraint app_record_links_unique_source_meeting to app_record_links_unique;
create index app_record_links_source_meeting_idx on public.app_record_links(source_meeting_id) where source_meeting_id is not null;

-- 2) 같은 업무공간 확인: 좁히기 전용. 기존 소유자 정책과 함께(AND) 적용된다.
create policy record_links_source_meeting_ws on public.app_record_links as restrictive
  for all to authenticated
  using (source_meeting_id is null or private.app_meeting_in_workspace(source_meeting_id, workspace_id))
  with check (source_meeting_id is null or private.app_meeting_in_workspace(source_meeting_id, workspace_id));

-- 5) 장소 칸(없을 때만 더함)과 길이 검사.
alter table public.app_meetings add column if not exists location text;
alter table public.app_meetings
  add constraint app_meetings_location_length_check check (location is null or char_length(location) <= 200);

-- 3) 저장 함수. p_targets = [{kind:'organization'|'project', target_id:uuid, summary?:text|null}] 0~20개.
--    목록에 없는 곳의 회의 출처 줄은 지운다(요약이 있으면 화면이 먼저 묻는다). 이미 연결된 곳은 선택 가능 검사를 다시 하지 않는다.
create function public.app_meeting_set_links(
  p_meeting_id uuid, p_meeting_updated_at timestamptz, p_targets jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $meeting$
declare
  v_meeting public.app_meetings%rowtype;
  v_target jsonb;
  v_id uuid;
  v_kind text;
  v_summary text;
  v_keys text[] := array[]::text[];
  v_link_id uuid;
  v_link_summary text;
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
  v_first_project uuid;
  v_inserted uuid;
  v_created integer := 0;
  v_existing integer := 0;
  v_removed integer := 0;
  v_updated timestamptz;
begin
  if p_meeting_id is null or p_meeting_updated_at is null or not pg_catalog.isfinite(p_meeting_updated_at) then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_INPUT');
  end if;
  if p_targets is null or pg_catalog.jsonb_typeof(p_targets) <> 'array'
     or pg_catalog.octet_length(p_targets::text) > 1048576
     or pg_catalog.jsonb_array_length(p_targets) > 20 then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS');
  end if;
  -- INVOKER: 보이지 않는 회의(다른 업무공간)는 잠글 수도 없고 MEETING_MISSING으로 끝난다.
  select m.* into v_meeting from public.app_meetings m where m.id = p_meeting_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','MEETING_MISSING');
  end if;
  if v_meeting.updated_at is distinct from p_meeting_updated_at then
    return pg_catalog.jsonb_build_object('ok',false,'error','MEETING_CHANGED');
  end if;
  -- 첫 쓰기 전에 모든 곳을 검사·잠근다. 하나라도 틀리면 아무것도 바꾸지 않는다.
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    if pg_catalog.jsonb_typeof(v_target) <> 'object'
       or exists(select 1 from pg_catalog.jsonb_object_keys(v_target) k where k not in ('kind','target_id','summary'))
       or not (v_target ?& array['kind','target_id'])
       or pg_catalog.jsonb_typeof(v_target->'kind') <> 'string'
       or (v_target->>'kind') not in ('organization','project')
       or pg_catalog.jsonb_typeof(v_target->'target_id') <> 'string'
       or (v_target->>'target_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS');
    end if;
    if v_target ? 'summary' and v_target->'summary' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_target->'summary') <> 'string'
         or not (pg_catalog.length(v_target->>'summary') between 1 and 2000 and pg_catalog.length(pg_catalog.btrim(v_target->>'summary', E' \t\n\r\f\v' || pg_catalog.chr(133) || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279))) > 0) then
        return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS');
      end if;
    end if;
    v_kind := v_target->>'kind';
    v_id := (v_target->>'target_id')::uuid;
    if (v_kind || ':' || v_id::text) = any(v_keys) then
      return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_TARGETS');
    end if;
    v_keys := pg_catalog.array_append(v_keys, v_kind || ':' || v_id::text);
    if v_kind = 'project' and v_first_project is null then v_first_project := v_id; end if;
    -- 이미 이 회의에 연결된 곳은 그대로 둘 수 있다(보관·옛 프로젝트여도).
    if exists(select 1 from public.app_record_links l where l.source_meeting_id = p_meeting_id
       and ((v_kind = 'organization' and l.organization_id = v_id) or (v_kind = 'project' and l.project_id = v_id))) then
      continue;
    end if;
    if v_kind = 'organization' then
      select o.workspace_id into v_workspace from public.app_suborganizations o where o.id = v_id for share;
      if not found then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING');
      end if;
      if v_workspace <> v_meeting.workspace_id then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_WORKSPACE');
      end if;
    else
      -- app_basket_confirm_links와 같은 선택 가능 규칙: v2 프로젝트(또는 그 아래), 보관된 조상 없음, 내 것.
      v_cursor := v_id; v_path := array[]::uuid[]; v_project := false;
      v_archived := false; v_selected_archived := false;
      while v_cursor is not null loop
        if v_cursor = any(v_path) then
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE');
        end if;
        select s.* into v_space from public.app_spaces s where s.id = v_cursor for share;
        if not found then
          if v_cursor = v_id then
            return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING');
          end if;
          exit;
        end if;
        if v_space.workspace_id <> v_meeting.workspace_id then
          if v_cursor <> v_id then exit; end if;
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_WORKSPACE');
        end if;
        if v_space.owner_id is distinct from auth.uid() then
          if v_cursor <> v_id then exit; end if;
          return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE');
        end if;
        v_archived := v_archived or coalesce(v_space.status = 'archived',false);
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
          v_selected_archived := v_archived;
        end if;
        v_path := pg_catalog.array_append(v_path,v_cursor); v_cursor := v_space.parent_id;
      end loop;
      if not v_project or v_selected_archived then
        return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_UNSELECTABLE');
      end if;
    end if;
  end loop;
  -- 빠진 곳의 회의 출처 줄을 지운다.
  delete from public.app_record_links l
   where l.source_meeting_id = p_meeting_id
     and not ((l.organization_id is not null and ('organization:' || l.organization_id::text) = any(v_keys))
           or (l.project_id is not null and ('project:' || l.project_id::text) = any(v_keys)));
  get diagnostics v_removed = row_count;
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    v_kind := v_target->>'kind';
    v_id := (v_target->>'target_id')::uuid;
    v_summary := case when v_target ? 'summary' and v_target->'summary' <> 'null'::jsonb then v_target->>'summary' end;
    v_inserted := null;
    insert into public.app_record_links(workspace_id,source_meeting_id,organization_id,project_id,status,report_kind,summary)
    values(v_meeting.workspace_id,p_meeting_id,
      case when v_kind = 'organization' then v_id end,
      case when v_kind = 'project' then v_id end,
      'confirmed',case when v_kind = 'organization' then 'organization' else 'business' end,v_summary)
    on conflict on constraint app_record_links_unique do nothing returning id into v_inserted;
    if v_inserted is not null then
      v_created := v_created + 1;
    else
      v_existing := v_existing + 1;
      -- 요약을 보낸 경우에만 바꾼다. 요약 없이 다시 고르면 기존 요약(보낸 기록)을 지킨다.
      if v_summary is not null then
        select l.id, l.summary into v_link_id, v_link_summary from public.app_record_links l
         where l.source_meeting_id = p_meeting_id
           and ((v_kind = 'organization' and l.organization_id = v_id) or (v_kind = 'project' and l.project_id = v_id));
        if v_link_summary is distinct from v_summary then
          update public.app_record_links l set summary = v_summary where l.id = v_link_id;
        end if;
      end if;
    end if;
  end loop;
  -- 회의 표의 프로젝트 한 칸은 '첫 프로젝트'로 맞춘다(이 칸을 읽는 곳이 연결 줄로 옮겨 갈 때까지).
  update public.app_meetings m set project_id = v_first_project
   where m.id = p_meeting_id and m.project_id is distinct from v_first_project;
  select m.updated_at into v_updated from public.app_meetings m where m.id = p_meeting_id;
  return pg_catalog.jsonb_build_object('ok',true,'created',v_created,'existing',v_existing,'removed',v_removed,
    'project_id',v_first_project,'updated_at',v_updated);
exception
  -- 예외 블록이 이 호출의 모든 쓰기를 되돌린 뒤 돌려준다(전부 아니면 전무).
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok',false,'error','PERMISSION_DENIED');
  when foreign_key_violation then
    return pg_catalog.jsonb_build_object('ok',false,'error','TARGET_MISSING');
end;
$meeting$;
revoke all on function public.app_meeting_set_links(uuid,timestamptz,jsonb) from public, anon, service_role;
grant execute on function public.app_meeting_set_links(uuid,timestamptz,jsonb) to authenticated;

-- 4) 기존 project_id가 있는 회의 → 같은 프로젝트로 회의 출처 줄 한 번 채우기(이미 있으면 건너뜀).
insert into public.app_record_links(workspace_id,source_meeting_id,project_id,status,report_kind)
select m.workspace_id, m.id, m.project_id, 'confirmed', 'business'
  from public.app_meetings m
 where m.project_id is not null
on conflict on constraint app_record_links_unique do nothing;

-- 사후 확인: 새 칸·FK·제약 모양·정책·함수 권한·채운 줄 수. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and contype = 'f'
       and confrelid = 'public.app_meetings'::regclass) <> 2
     or (select count(*) from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.conrelid = 'public.app_record_links'::regclass and c.conname = 'app_record_links_source_meeting_id_fkey' and c.contype = 'f'
           and c.confrelid = 'public.app_meetings'::regclass and c.confdeltype = 'c' and array_length(c.conkey, 1) = 1
           and a.attname = 'source_meeting_id') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_meeting_id_fkey') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_one_source'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g') = 'CHECKnum_nonnullsgoogle_task_id,note_id,source_meeting_id=1') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_unique'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_record_links'::regclass and conname = 'app_record_links_source_meeting_shape'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g')
           = 'CHECKsource_meeting_idISNULLORmeeting_idISNULLANDdocument_idISNULLANDstatus=''confirmed''::text') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass and conname = 'app_meetings_location_length_check'
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g') = 'CHECKlocationISNULLORchar_lengthlocation<=200') <> 1
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and attname = 'location'
         and not attisdropped and atttypid = 'text'::regtype and not attnotnull)
     or exists (select 1 from pg_class where oid in ('public.app_meetings'::regclass, 'public.app_record_links'::regclass)
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_source_meeting_ws'
         and not polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g')
           = 'source_meeting_idISNULLORprivate.app_meeting_in_workspacesource_meeting_id,workspace_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g')
           = 'source_meeting_idISNULLORprivate.app_meeting_in_workspacesource_meeting_id,workspace_id') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_meeting_set_links(uuid,timestamptz,jsonb)')
         and not prosecdef and proconfig = array['search_path=""'] and proacl::text !~ '(^|[{,])(anon|service_role)?=') <> 1
     or (select count(*) from public.app_record_links l join public.app_meetings m on m.id = l.source_meeting_id
         where l.project_id = m.project_id) <> (select count(*) from public.app_meetings where project_id is not null)
     or exists (select 1 from public.app_record_links where source_meeting_id is not null and summary is not null) then
    raise exception 'BIZREPORT_MEETING_LINKS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023023500', 'bizreport_meeting_links', array['MTG-사업보고 DB-2 + MEET-기록보내기 B1: app_record_links.source_meeting_id + source/unique/shape checks + restrictive workspace policy + app_meeting_set_links (INVOKER) + project_id backfill; app_meetings.location if missing + 200 char check']);
commit;
