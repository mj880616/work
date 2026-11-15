begin;
-- LIB-AI분류보완 (사용자 요청 2026-10-23 11:04): 자료실 AI가 파일 글자로 비어 있는 프로젝트·담당조직 연결도 채우고,
-- 기존 자료를 한 번씩(글자가 나중에 들어온 자료는 한 번 더) 다시 보며, 그 묶음 전체를 되돌릴 수 있게 하는 DB 바탕.
-- 1) app_documents.field_origin 검사: 키에 project_id·organization_id를 더한다(값은 그대로 'ai'·'user'만). 기존 값은 바뀌지 않는다.
-- 2) app_library_tidy_backups.field 검사: 같은 두 칸을 더한다(연결의 원래 값 = 비어 있음을 백업).
-- 3) app_library_classify_attempts: 분류 시도 기록(자료마다 1행, 그때 글자로 판단했는지 with_text). 기존 시도 기록 표는 그대로 둔다.
-- 4) public.app_library_classify_apply(uuid,jsonb): 백업 + 자료 칸 바꾸기('ai' 기록) + 시도 기록을 한 트랜잭션으로.
--    연결은 지금 비어 있을 때만, 같은 업무공간의 보관 안 된 프로젝트·쓰는 담당조직일 때만 넣는다. 'user' 칸·이미 있는 연결이면 전체 취소.
-- 5) public.app_library_classify_revert(uuid): 한 묶음 되돌리기(6칸). 지금 값이 AI 값 그대로이고 기록이 'ai'인 칸만 원래대로.
-- 6) public.app_library_classify_revert_since(timestamptz): 그 시각 뒤에 만든 모든 묶음 되돌리기(전체 정리 한 번에 취소).
-- 세 함수 모두 SECURITY INVOKER·search_path ''. 호출한 사람의 권한과 기존 owner RLS(private.app_is_workspace_owner)·
-- 같은 업무공간 트리거(app_documents_workspace_consistency)가 그대로 걸린다. 새 표는 RLS 켜고 owner 정책만,
-- PUBLIC·anon·service_role 권한 없음. 기존 정책·권한·자료 값은 바꾸지 않는다. 기존 함수 app_library_auto_tidy_*는 그대로 둔다.
-- 짝: docs/20261023120000_library_ai_classify.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 넓혀서 통과시키지 않는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023120000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022212757' and name = 'library_auto_tidy') <> 1
     or to_regclass('public.app_library_classify_attempts') is not null
     or to_regprocedure('public.app_library_classify_apply(uuid,jsonb)') is not null
     or to_regprocedure('public.app_library_classify_revert(uuid)') is not null
     or to_regprocedure('public.app_library_classify_revert_since(timestamptz)') is not null
     or to_regclass('public.app_library_tidy_backups') is null
     or not exists (select 1 from pg_constraint
         where conrelid = 'public.app_documents'::regclass and conname = 'app_documents_field_origin_check')
     or not exists (select 1 from pg_constraint
         where conrelid = 'public.app_library_tidy_backups'::regclass and conname = 'app_library_tidy_backups_field_check')
     or not exists (select 1 from pg_attribute
         where attrelid = 'public.app_spaces'::regclass and not attisdropped and attname = 'status')
     or not exists (select 1 from pg_attribute
         where attrelid = 'public.app_suborganizations'::regclass and not attisdropped and attname = 'active')
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'LIBRARY_AI_CLASSIFY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 칸별 기록 키 6개. 기존 4개 키 검사를 그대로 두고 두 키만 더한다.
alter table public.app_documents
  drop constraint app_documents_field_origin_check;
alter table public.app_documents
  add constraint app_documents_field_origin_check check (
    jsonb_typeof(field_origin) = 'object'
    and (field_origin - array['title', 'category', 'source', 'document_date', 'project_id', 'organization_id']) = '{}'::jsonb
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')
  );

-- 2) 백업 칸 6개. 새 값 글자 수 검사(1~120자)는 그대로(ID는 36자).
alter table public.app_library_tidy_backups
  drop constraint app_library_tidy_backups_field_check;
alter table public.app_library_tidy_backups
  add constraint app_library_tidy_backups_field_check
  check (field in ('title', 'category', 'source', 'document_date', 'project_id', 'organization_id'));

-- 3) 분류 시도 기록: 자료마다 1행. with_text=false(파일 이름만으로 판단)인 자료는 글자가 들어오면 한 번 더 볼 수 있다.
create table public.app_library_classify_attempts (
  document_id uuid primary key references public.app_documents(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  batch_id uuid not null,
  with_text boolean not null default false,
  changed smallint not null default 0,
  tried_at timestamptz not null default now(),
  constraint app_library_classify_attempts_changed_check check (changed between 0 and 6)
);
create index app_library_classify_attempts_workspace_idx on public.app_library_classify_attempts(workspace_id);

alter table public.app_library_classify_attempts enable row level security;
revoke all on table public.app_library_classify_attempts from public, anon, authenticated, service_role;
grant select on table public.app_library_classify_attempts to authenticated;
grant insert (document_id, workspace_id, batch_id, with_text, changed) on table public.app_library_classify_attempts to authenticated;
grant update (batch_id, with_text, changed, tried_at) on table public.app_library_classify_attempts to authenticated;
create policy library_classify_attempts_owner_all on public.app_library_classify_attempts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_documents d
      where d.id = document_id and d.workspace_id = app_library_classify_attempts.workspace_id));

-- 4) 적용: p_items = [{document_id, updated_at, with_text, changes:{칸: 새 값}}] 1~10개. changes가 비면 시도 기록만 남긴다.
--    자료마다: 행 잠금 → updated_at이 읽을 때와 다르면 건너뜀(moved, 시도 기록도 안 남김) → 칸마다 검사·백업 → 자료 칸·기록 → 시도 기록.
--    형식이 틀리거나 'user' 칸이거나 이미 있는 연결을 바꾸려 하면 예외로 전체 취소. 연결 값은 지우지 않는다(빈 값은 받지 않음).
create function public.app_library_classify_apply(p_batch uuid, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item jsonb;
  v_doc record;
  v_changes jsonb;
  v_field text;
  v_new text;
  v_old text;
  v_set jsonb;
  v_marks jsonb;
  v_count integer;
  v_documents integer := 0;
  v_fields integer := 0;
  v_moved integer := 0;
begin
  if p_batch is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 10 then
    raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or (v_item - array['document_id', 'updated_at', 'with_text', 'changes']) <> '{}'::jsonb
       or jsonb_typeof(v_item->'document_id') is distinct from 'string'
       or jsonb_typeof(v_item->'updated_at') is distinct from 'string'
       or jsonb_typeof(v_item->'with_text') is distinct from 'boolean'
       or jsonb_typeof(v_item->'changes') is distinct from 'object'
       or ((v_item->'changes') - array['title', 'category', 'source', 'document_date', 'project_id', 'organization_id']) <> '{}'::jsonb then
      raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
    end if;
    select d.id, d.workspace_id, d.title, d.category, d.source, d.document_date::text as document_date,
           d.project_id::text as project_id, d.organization_id::text as organization_id, d.field_origin, d.updated_at
      into v_doc
      from public.app_documents d
      where d.id = (v_item->>'document_id')::uuid
      for update;
    if not found or v_doc.updated_at is distinct from nullif(v_item->>'updated_at', '')::timestamptz then
      v_moved := v_moved + 1;
      continue;
    end if;
    v_changes := v_item->'changes';
    v_set := '{}'::jsonb;
    v_marks := '{}'::jsonb;
    v_count := 0;
    for v_field in select k from jsonb_object_keys(v_changes) k loop
      if jsonb_typeof(v_changes->v_field) is distinct from 'string' then
        raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
      end if;
      if coalesce(v_doc.field_origin->>v_field, '') = 'user' then
        raise exception 'LIBRARY_CLASSIFY_USER_FIELD' using errcode = '42501';
      end if;
      v_new := v_changes->>v_field;
      if v_field in ('project_id', 'organization_id') then
        -- 연결: 지금 비어 있고 칸 기록이 없을 때만(사람이 붙였거나 뺀 연결은 손대지 않음). 값은 같은 업무공간의 것만.
        if (case v_field when 'project_id' then v_doc.project_id else v_doc.organization_id end) is not null
           or v_doc.field_origin ? v_field then
          raise exception 'LIBRARY_CLASSIFY_LINK_TAKEN' using errcode = '42501';
        end if;
        if v_new !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or (v_field = 'project_id' and not exists (
                 select 1 from public.app_spaces s
                 where s.id = v_new::uuid and s.workspace_id = v_doc.workspace_id and s.status is distinct from 'archived'))
           or (v_field = 'organization_id' and not exists (
                 select 1 from public.app_suborganizations o
                 where o.id = v_new::uuid and o.workspace_id = v_doc.workspace_id and o.active is distinct from false)) then
          raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
        end if;
        v_old := null;
      else
        if v_new ~ '[[:cntrl:]<>]' or v_new <> btrim(v_new)
           or (v_field = 'title' and char_length(v_new) not between 1 and 120)
           or (v_field = 'source' and char_length(v_new) not between 1 and 60)
           or (v_field = 'category' and char_length(v_new) not between 1 and 20)
           or (v_field = 'document_date' and (v_new !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               or v_new::date < date '1980-01-01' or v_new::date > current_date + 366)) then
          raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
        end if;
        v_old := case v_field when 'title' then v_doc.title when 'category' then v_doc.category
          when 'source' then v_doc.source else v_doc.document_date end;
        if v_old is not distinct from v_new then
          continue;
        end if;
      end if;
      insert into public.app_library_tidy_backups (workspace_id, batch_id, document_id, field, old_value, old_origin, new_value)
        values (v_doc.workspace_id, p_batch, v_doc.id, v_field, v_old, v_doc.field_origin->>v_field, v_new);
      v_set := v_set || jsonb_build_object(v_field, v_new);
      v_marks := v_marks || jsonb_build_object(v_field, 'ai');
      v_count := v_count + 1;
    end loop;
    if v_count > 0 then
      update public.app_documents
        set title = case when v_set ? 'title' then v_set->>'title' else title end,
            category = case when v_set ? 'category' then v_set->>'category' else category end,
            source = case when v_set ? 'source' then v_set->>'source' else source end,
            document_date = case when v_set ? 'document_date' then (v_set->>'document_date')::date else document_date end,
            project_id = case when v_set ? 'project_id' then (v_set->>'project_id')::uuid else project_id end,
            organization_id = case when v_set ? 'organization_id' then (v_set->>'organization_id')::uuid else organization_id end,
            field_origin = field_origin || v_marks,
            updated_at = now()
        where id = v_doc.id;
      v_documents := v_documents + 1;
      v_fields := v_fields + v_count;
    end if;
    -- 시도 기록: 처음이면 넣고, 전에 파일 이름만으로 봤으면(with_text=false) 이번 결과로 한 번 고친다.
    insert into public.app_library_classify_attempts (document_id, workspace_id, batch_id, with_text, changed)
      values (v_doc.id, v_doc.workspace_id, p_batch, (v_item->>'with_text')::boolean, v_count)
      on conflict (document_id) do update
        set batch_id = excluded.batch_id, with_text = excluded.with_text, changed = excluded.changed, tried_at = now()
        where not public.app_library_classify_attempts.with_text;
  end loop;
  return jsonb_build_object('documents', v_documents, 'fields', v_fields, 'moved', v_moved);
end
$$;
revoke all on function public.app_library_classify_apply(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_library_classify_apply(uuid, jsonb) to authenticated;

-- 5) 되돌리기(한 묶음, 6칸): 지금 값이 AI 새 값 그대로이고 칸 기록이 'ai'인 칸만 원래 값·원래 기록(없으면 기록 지움)으로.
--    그 사이 사용자가 고친 칸은 건너뛴다(skipped, 백업 행 그대로). 시도 기록은 남겨 같은 자료를 다시 AI에 보내지 않는다.
create function public.app_library_classify_revert(p_batch uuid) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_row record;
  v_cur text;
  v_cur_origin text;
  v_reverted integer := 0;
  v_skipped integer := 0;
begin
  if p_batch is null then
    raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
  end if;
  for v_row in
    select b.id, b.document_id, b.field, b.old_value, b.old_origin, b.new_value
      from public.app_library_tidy_backups b
      where b.batch_id = p_batch and b.reverted_at is null
      order by b.created_at, b.id
      for update
  loop
    select case v_row.field when 'title' then d.title when 'category' then d.category
             when 'source' then d.source when 'document_date' then d.document_date::text
             when 'project_id' then d.project_id::text else d.organization_id::text end,
           d.field_origin->>v_row.field
      into v_cur, v_cur_origin
      from public.app_documents d
      where d.id = v_row.document_id
      for update;
    if not found or v_cur is distinct from v_row.new_value or v_cur_origin is distinct from 'ai'
       -- 원래 연결이 있었는데 그 프로젝트·조직이 그 사이 지워졌으면 되돌릴 곳이 없으므로 건너뛴다.
       or (v_row.field = 'project_id' and v_row.old_value is not null
           and not exists (select 1 from public.app_spaces s where s.id = v_row.old_value::uuid))
       or (v_row.field = 'organization_id' and v_row.old_value is not null
           and not exists (select 1 from public.app_suborganizations o where o.id = v_row.old_value::uuid)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update public.app_documents
      set title = case when v_row.field = 'title' then v_row.old_value else title end,
          category = case when v_row.field = 'category' then v_row.old_value else category end,
          source = case when v_row.field = 'source' then v_row.old_value else source end,
          document_date = case when v_row.field = 'document_date' then v_row.old_value::date else document_date end,
          project_id = case when v_row.field = 'project_id' then v_row.old_value::uuid else project_id end,
          organization_id = case when v_row.field = 'organization_id' then v_row.old_value::uuid else organization_id end,
          field_origin = case when v_row.old_origin is null then field_origin - v_row.field
                         else field_origin || jsonb_build_object(v_row.field, v_row.old_origin) end,
          updated_at = now()
      where id = v_row.document_id;
    update public.app_library_tidy_backups
      set reverted_at = now()
      where id = v_row.id;
    v_reverted := v_reverted + 1;
  end loop;
  return jsonb_build_object('reverted', v_reverted, 'skipped', v_skipped);
end
$$;
revoke all on function public.app_library_classify_revert(uuid) from public, anon, service_role;
grant execute on function public.app_library_classify_revert(uuid) to authenticated;

-- 6) 전체 되돌리기: p_since 뒤에 만든 아직 안 되돌린 묶음을 최근 것부터 하나씩 5)로 되돌린다(같은 규칙, 고친 칸은 건너뜀).
--    지난 기존 자동 정리(LIB-자동정리) 묶음도 그 시각 뒤라면 함께 되돌린다. 묶음 수는 결과에 남긴다.
create function public.app_library_classify_revert_since(p_since timestamptz) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_batch uuid;
  v_result jsonb;
  v_batches integer := 0;
  v_reverted integer := 0;
  v_skipped integer := 0;
begin
  if p_since is null then
    raise exception 'LIBRARY_CLASSIFY_INVALID' using errcode = '22023';
  end if;
  for v_batch in
    select b.batch_id
      from public.app_library_tidy_backups b
      where b.created_at >= p_since and b.reverted_at is null
      group by b.batch_id
      order by max(b.created_at) desc, b.batch_id
  loop
    v_result := public.app_library_classify_revert(v_batch);
    v_batches := v_batches + 1;
    v_reverted := v_reverted + (v_result->>'reverted')::integer;
    v_skipped := v_skipped + (v_result->>'skipped')::integer;
  end loop;
  return jsonb_build_object('batches', v_batches, 'reverted', v_reverted, 'skipped', v_skipped);
end
$$;
revoke all on function public.app_library_classify_revert_since(timestamptz) from public, anon, service_role;
grant execute on function public.app_library_classify_revert_since(timestamptz) to authenticated;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 함수 INVOKER, 기존 자료에 새 키 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_library_classify_attempts'::regclass
             and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or exists (select 1 from pg_attribute where attrelid = 'public.app_library_classify_attempts'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_library_classify_attempts'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_classify_attempts'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_proc where oid in (to_regprocedure('public.app_library_classify_apply(uuid,jsonb)'),
               to_regprocedure('public.app_library_classify_revert(uuid)'), to_regprocedure('public.app_library_classify_revert_since(timestamptz)'))
             and (prosecdef or proacl::text ~ '(^|[{,])(anon|service_role)?='))
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or exists (select 1 from public.app_documents where field_origin ?| array['project_id', 'organization_id'])
     or exists (select 1 from public.app_library_classify_attempts) then
    raise exception 'LIBRARY_AI_CLASSIFY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023120000', 'library_ai_classify', array['LIB-AI분류보완: field_origin/backup keys + project_id/organization_id, app_library_classify_attempts (owner RLS), app_library_classify_apply/revert/revert_since (invoker, authenticated only)']);
commit;
