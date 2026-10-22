begin;
-- LIB-자동정리 (2026-10-22 사용자 결정 20:42 백업 위치 = 서버 안 백업 표, 20:54 "손으로 입력하지 않은 칸은 백그라운드에서 알아서").
-- 자료실 기존 자료의 정리 안 된 칸(제목·분류·출처·자료 날짜 중 사용자가 넣지 않은 칸)을 ai-assist(library_fill, mode tidy)가 채울 때의 DB 바탕.
-- 1) app_library_tidy_backups: 바꾸기 전 원래 값(묶음 id·자료 id·칸·원래 값·원래 칸 기록·새 값·시각·되돌린 시각). 칸마다 1행.
-- 2) app_library_tidy_attempts: AI에 한 번 보낸 자료(자료마다 1행). 같은 자료를 다시 AI에 보내지 않는다(되돌린 뒤에도).
-- 3) public.app_library_auto_tidy_apply(uuid,jsonb): 백업 행 넣기 + 자료 칸 바꾸기(field_origin 'ai') + 시도 기록을 한 트랜잭션으로.
--    읽은 뒤 자료가 바뀌었으면(updated_at 다름) 건너뛴다. 사용자 칸('user')은 DB에서도 거절한다.
-- 4) public.app_library_auto_tidy_revert(uuid): 한 묶음 되돌리기. 지금 값이 AI 새 값 그대로이고 칸 기록이 'ai'인 칸만 원래 값·원래 기록으로.
--    화면 버튼은 없다. 필요하면 커맨드센터가 준비한 SQL을 사용자가 SQL Editor에서 실행한다(docs/design/library-ai-fill.md 7절).
-- 두 함수 모두 SECURITY INVOKER·search_path ''. 호출한 사람의 권한과 기존 owner RLS(private.app_is_workspace_owner)가 그대로 걸린다.
-- 새 표는 RLS 켜고 owner 정책만, PUBLIC·anon·service_role 권한 없음. 기존 표·정책·자료는 바꾸지 않는다.
-- 짝: docs/20261022212757_library_auto_tidy.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 넓혀서 통과시키지 않는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022212757')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022100000' and name = 'library_ai_fill') <> 1
     or to_regclass('public.app_library_tidy_backups') is not null
     or to_regclass('public.app_library_tidy_attempts') is not null
     or to_regprocedure('public.app_library_auto_tidy_apply(uuid,jsonb)') is not null
     or to_regprocedure('public.app_library_auto_tidy_revert(uuid)') is not null
     or to_regclass('public.app_documents') is null
     or not exists (select 1 from pg_attribute
         where attrelid = 'public.app_documents'::regclass and not attisdropped and attname = 'field_origin')
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'LIBRARY_AUTO_TIDY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 원래 값 백업. 값은 글자로 둔다(자료 날짜는 YYYY-MM-DD). old_origin = 바꾸기 전 칸 기록(없음 또는 'ai'; 'user' 칸은 바꾸지 않음).
create table public.app_library_tidy_backups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  batch_id uuid not null,
  document_id uuid not null references public.app_documents(id) on delete cascade,
  field text not null,
  old_value text,
  old_origin text,
  new_value text not null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  constraint app_library_tidy_backups_field_check check (field in ('title', 'category', 'source', 'document_date')),
  constraint app_library_tidy_backups_origin_check check (old_origin is null or old_origin = 'ai'),
  constraint app_library_tidy_backups_new_check check (char_length(new_value) between 1 and 120)
);
create index app_library_tidy_backups_batch_idx on public.app_library_tidy_backups(batch_id);
create index app_library_tidy_backups_document_idx on public.app_library_tidy_backups(document_id);

-- 2) 시도 기록: 자료마다 1행(묶음 id·시각·바꾼 칸 수). 자료가 지워지면 같이 지워진다.
create table public.app_library_tidy_attempts (
  document_id uuid primary key references public.app_documents(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  batch_id uuid not null,
  changed smallint not null default 0,
  tried_at timestamptz not null default now(),
  constraint app_library_tidy_attempts_changed_check check (changed between 0 and 4)
);
create index app_library_tidy_attempts_workspace_idx on public.app_library_tidy_attempts(workspace_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated는 읽기와 함수가 쓰는 칸만(백업 행 넣기·되돌린 시각 고치기·시도 넣기).
alter table public.app_library_tidy_backups enable row level security;
alter table public.app_library_tidy_attempts enable row level security;
revoke all on table public.app_library_tidy_backups from public, anon, authenticated, service_role;
revoke all on table public.app_library_tidy_attempts from public, anon, authenticated, service_role;
grant select on table public.app_library_tidy_backups to authenticated;
grant insert (workspace_id, batch_id, document_id, field, old_value, old_origin, new_value)
  on table public.app_library_tidy_backups to authenticated;
grant update (reverted_at) on table public.app_library_tidy_backups to authenticated;
grant select on table public.app_library_tidy_attempts to authenticated;
grant insert (document_id, workspace_id, batch_id, changed) on table public.app_library_tidy_attempts to authenticated;

create policy library_tidy_backups_owner_all on public.app_library_tidy_backups for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_documents d
      where d.id = document_id and d.workspace_id = app_library_tidy_backups.workspace_id));
create policy library_tidy_attempts_owner_all on public.app_library_tidy_attempts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_documents d
      where d.id = document_id and d.workspace_id = app_library_tidy_attempts.workspace_id));

-- 3) 적용: p_items = [{document_id, updated_at, changes:{칸: 새 값}}] 1~10개. changes가 비면 시도 기록만 남긴다.
--    자료마다: 행 잠금 → updated_at이 읽을 때와 다르면 건너뜀(moved) → 칸마다 검사·백업 → 자료 칸·기록 바꾸기 → 시도 기록.
--    형식이 틀리거나 사용자 칸이면 예외로 전체 취소(백업만 남거나 값만 바뀌는 일 없음).
create function public.app_library_auto_tidy_apply(p_batch uuid, p_items jsonb) returns jsonb
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
    raise exception 'LIBRARY_TIDY_INVALID' using errcode = '22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or (v_item - array['document_id', 'updated_at', 'changes']) <> '{}'::jsonb
       or jsonb_typeof(v_item->'document_id') is distinct from 'string'
       or jsonb_typeof(v_item->'updated_at') is distinct from 'string'
       or jsonb_typeof(v_item->'changes') is distinct from 'object'
       or ((v_item->'changes') - array['title', 'category', 'source', 'document_date']) <> '{}'::jsonb then
      raise exception 'LIBRARY_TIDY_INVALID' using errcode = '22023';
    end if;
    select d.id, d.workspace_id, d.title, d.category, d.source, d.document_date::text as document_date, d.field_origin, d.updated_at
      into v_doc
      from public.app_documents d
      where d.id = (v_item->>'document_id')::uuid
      for update;
    if not found or v_doc.updated_at is distinct from (v_item->>'updated_at')::timestamptz then
      v_moved := v_moved + 1;
      continue;
    end if;
    v_changes := v_item->'changes';
    v_set := '{}'::jsonb;
    v_marks := '{}'::jsonb;
    v_count := 0;
    for v_field in select k from jsonb_object_keys(v_changes) k loop
      if jsonb_typeof(v_changes->v_field) is distinct from 'string' then
        raise exception 'LIBRARY_TIDY_INVALID' using errcode = '22023';
      end if;
      if coalesce(v_doc.field_origin->>v_field, '') = 'user' then
        raise exception 'LIBRARY_TIDY_USER_FIELD' using errcode = '42501';
      end if;
      v_new := v_changes->>v_field;
      if v_new ~ '[[:cntrl:]<>]' or v_new <> btrim(v_new)
         or (v_field = 'title' and char_length(v_new) not between 1 and 120)
         or (v_field = 'source' and char_length(v_new) not between 1 and 60)
         or (v_field = 'category' and char_length(v_new) not between 1 and 20)
         or (v_field = 'document_date' and (v_new !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             or v_new::date < date '1980-01-01' or v_new::date > current_date + 366)) then
        raise exception 'LIBRARY_TIDY_INVALID' using errcode = '22023';
      end if;
      v_old := case v_field when 'title' then v_doc.title when 'category' then v_doc.category
        when 'source' then v_doc.source else v_doc.document_date end;
      if v_old is not distinct from v_new then
        continue;
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
            field_origin = field_origin || v_marks,
            updated_at = now()
        where id = v_doc.id;
      v_documents := v_documents + 1;
      v_fields := v_fields + v_count;
    end if;
    insert into public.app_library_tidy_attempts (document_id, workspace_id, batch_id, changed)
      values (v_doc.id, v_doc.workspace_id, p_batch, v_count)
      on conflict (document_id) do nothing;
  end loop;
  return jsonb_build_object('documents', v_documents, 'fields', v_fields, 'moved', v_moved);
end
$$;
revoke all on function public.app_library_auto_tidy_apply(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_library_auto_tidy_apply(uuid, jsonb) to authenticated;

-- 4) 되돌리기: 한 묶음의 아직 안 되돌린 칸. 지금 값이 AI 새 값 그대로이고 칸 기록이 'ai'인 칸만 원래 값·원래 기록(없으면 기록 지움)으로.
--    그 사이 사용자가 고친 칸은 건너뛴다(skipped, 백업 행은 그대로 남음). 시도 기록은 남겨 같은 자료를 다시 AI에 보내지 않는다.
create function public.app_library_auto_tidy_revert(p_batch uuid) returns jsonb
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
    raise exception 'LIBRARY_TIDY_INVALID' using errcode = '22023';
  end if;
  for v_row in
    select b.id, b.document_id, b.field, b.old_value, b.old_origin, b.new_value
      from public.app_library_tidy_backups b
      where b.batch_id = p_batch and b.reverted_at is null
      order by b.created_at, b.id
      for update
  loop
    select case v_row.field when 'title' then d.title when 'category' then d.category
             when 'source' then d.source else d.document_date::text end,
           d.field_origin->>v_row.field
      into v_cur, v_cur_origin
      from public.app_documents d
      where d.id = v_row.document_id
      for update;
    if not found or v_cur is distinct from v_row.new_value or v_cur_origin is distinct from 'ai' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update public.app_documents
      set title = case when v_row.field = 'title' then v_row.old_value else title end,
          category = case when v_row.field = 'category' then v_row.old_value else category end,
          source = case when v_row.field = 'source' then v_row.old_value else source end,
          document_date = case when v_row.field = 'document_date' then v_row.old_value::date else document_date end,
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
revoke all on function public.app_library_auto_tidy_revert(uuid) from public, anon, service_role;
grant execute on function public.app_library_auto_tidy_revert(uuid) to authenticated;

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 기존 자료 값 그대로. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_library_tidy_backups'::regclass, 'public.app_library_tidy_attempts'::regclass)
             and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or exists (select 1 from pg_attribute where attrelid in ('public.app_library_tidy_backups'::regclass, 'public.app_library_tidy_attempts'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_library_tidy_backups'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_tidy_backups'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_tidy_attempts'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_tidy_attempts'::regclass) <> 1
     or exists (select 1 from pg_proc where oid in (to_regprocedure('public.app_library_auto_tidy_apply(uuid,jsonb)'), to_regprocedure('public.app_library_auto_tidy_revert(uuid)'))
             and (prosecdef or proacl::text ~ '(^|[{,])(anon|service_role)?='))
     or exists (select 1 from public.app_library_tidy_backups)
     or exists (select 1 from public.app_library_tidy_attempts) then
    raise exception 'LIBRARY_AUTO_TIDY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022212757', 'library_auto_tidy', array['LIB-자동정리: app_library_tidy_backups + app_library_tidy_attempts (owner RLS), app_library_auto_tidy_apply/revert (invoker, authenticated only)']);
commit;
