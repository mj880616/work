begin;
-- UI-바구니첨부메모 PR 2(2026-10-18 사용자 결정 A1 + 분류 목록): 자료를 담당조직에 붙이는 칸과 자료 분류 목록 저장.
-- 1) app_documents.organization_id: 비어 있어도 됨, 조직이 지워지면 연결만 비움. 기존 owner 쓰기 검사에
--    "같은 workspace의 조직" 확인만 더한다(USING·역할·RLS는 그대로).
-- 2) app_workspaces.document_categories: 분류 목록(기본 7개). 새 표 없이 기존 owner 표에 칸 하나.
-- 3) 이름 바꾸기·삭제는 목록과 그 분류 자료를 한 번에 바꾸는 SECURITY INVOKER 함수(owner RLS 그대로, authenticated만 실행).
-- 기존 행·저장된 분류 값은 바꾸지 않는다. 새 grant(표)·새 정책·RLS 끄기·Edge 변경 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_workspaces, public.app_documents in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 고쳐서 통과시키지 않는다).
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261012100000' and name = 'basket_link_view_db') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261018023753')
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_proc
         where proname = 'app_is_workspace_owner' and pronamespace = 'private'::regnamespace)
     or exists (select 1 from pg_proc
         where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
           and proname in ('app_document_categories_valid', 'app_document_category_add',
                           'app_document_category_rename', 'app_document_category_delete'))
     -- app_documents: 새 칸 없음, RLS 켜짐, anon·PUBLIC 표 권한 없음, owner 정책 1개가 지금 모양 그대로.
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_documents'::regclass and not attisdropped and attname = 'organization_id')
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_documents' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     or exists (select 1 from pg_class
         where relnamespace = 'public'::regnamespace and relname = 'app_documents_organization_idx')
     -- app_workspaces: 새 칸 없음, RLS 켜짐, anon·PUBLIC 표 권한 없음, owner 정책 1개, authenticated에 UPDATE가 이미 있음.
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_workspaces'::regclass and not attisdropped and attname = 'document_categories')
     or exists (select 1 from pg_class where oid = 'public.app_workspaces'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_workspaces'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_workspaces'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_workspaces'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_workspaces' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1 then
    raise exception 'DOC_ORG_CATEGORIES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 자료 → 담당조직. 하나의 자료는 조직 하나(프로젝트 칸과 같은 모양).
alter table public.app_documents
  add column organization_id uuid references public.app_suborganizations(id) on delete set null;
create index app_documents_organization_idx
  on public.app_documents (organization_id) where organization_id is not null;
-- 기존 owner 검사에 "같은 workspace의 조직"만 더한다. 지금 쓰는 앱 요청은 organization_id를 보내지 않으므로 그대로 통과한다.
alter policy task12a_owner_all on public.app_documents
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o
      where o.id = organization_id and o.workspace_id = app_documents.workspace_id))
  );

-- 2) 분류 목록 검사: 1~30개, 이름 1~20자(앞뒤 공백·줄바꿈·쉼표 없음), 겹침 없음, '기타'는 늘 있음.
create function private.app_document_categories_valid(p_names text[]) returns boolean
language sql immutable security invoker set search_path = ''
as $valid$
  select p_names is not null
    and pg_catalog.cardinality(p_names) between 1 and 30
    and pg_catalog.array_position(p_names, null) is null
    and '기타' = any (p_names)
    and not exists (
      select 1 from pg_catalog.unnest(p_names) as n(name)
      where pg_catalog.length(n.name) not between 1 and 20
        or n.name <> pg_catalog.btrim(n.name)
        or n.name ~ '[[:cntrl:],]')
    and (select pg_catalog.count(distinct n.name) from pg_catalog.unnest(p_names) as n(name))
      = pg_catalog.cardinality(p_names)
$valid$;
revoke all on function private.app_document_categories_valid(text[]) from public, anon;
grant execute on function private.app_document_categories_valid(text[]) to authenticated;

alter table public.app_workspaces
  add column document_categories text[] not null
    default array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[];
alter table public.app_workspaces
  add constraint app_workspaces_document_categories_check
    check (private.app_document_categories_valid(document_categories));

-- 3) 분류 추가: 목록 끝에 하나.
create function public.app_document_category_add(p_workspace_id uuid, p_name text) returns jsonb
language plpgsql security invoker set search_path = ''
as $add$
declare
  v_list text[];
  v_name text := pg_catalog.btrim(p_name);
begin
  if auth.uid() is null or p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select w.document_categories into v_list from public.app_workspaces w where w.id = p_workspace_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_name = any (v_list) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_EXISTS');
  end if;
  if v_name is null or not private.app_document_categories_valid(pg_catalog.array_append(v_list, v_name)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  update public.app_workspaces set document_categories = pg_catalog.array_append(document_categories, v_name)
    where id = p_workspace_id;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_append(v_list, v_name));
exception when insufficient_privilege then
  return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$add$;
revoke all on function public.app_document_category_add(uuid, text) from public, anon;
grant execute on function public.app_document_category_add(uuid, text) to authenticated;

-- 이름 바꾸기: 목록의 이름과 그 분류 자료를 한 트랜잭션에서 바꾼다.
-- p_stored: 화면에서 이 분류로 보이던 예전 저장 값(예: 정부자료). 목록에 있는 다른 분류 이름은 받지 않는다.
create function public.app_document_category_rename(p_workspace_id uuid, p_from text, p_to text, p_stored text[]) returns jsonb
language plpgsql security invoker set search_path = ''
as $rename$
declare
  v_list text[];
  v_to text := pg_catalog.btrim(p_to);
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_count integer;
begin
  if auth.uid() is null or p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select w.document_categories into v_list from public.app_workspaces w where w.id = p_workspace_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if p_from is null or not (p_from = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  if p_from = '기타' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_LOCKED');
  end if;
  if v_to = p_from then
    return pg_catalog.jsonb_build_object('ok', true, 'categories', v_list, 'documents', 0);
  end if;
  if v_to = any (v_list) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_EXISTS');
  end if;
  if v_to is null or not private.app_document_categories_valid(pg_catalog.array_replace(v_list, p_from, v_to)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  if pg_catalog.cardinality(v_stored) > 50
     or exists (select 1 from pg_catalog.unnest(v_stored) as s(value) where s.value is null or s.value = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  update public.app_workspaces set document_categories = pg_catalog.array_replace(document_categories, p_from, v_to)
    where id = p_workspace_id;
  update public.app_documents set category = v_to, updated_at = pg_catalog.now()
    where workspace_id = p_workspace_id and category = any (pg_catalog.array_append(v_stored, p_from));
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_replace(v_list, p_from, v_to), 'documents', v_count);
exception when insufficient_privilege then
  return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$rename$;
revoke all on function public.app_document_category_rename(uuid, text, text, text[]) from public, anon;
grant execute on function public.app_document_category_rename(uuid, text, text, text[]) to authenticated;

-- 삭제: 목록에서 빼고 그 분류 자료는 '기타'로. '기타'는 지울 수 없다.
create function public.app_document_category_delete(p_workspace_id uuid, p_name text, p_stored text[]) returns jsonb
language plpgsql security invoker set search_path = ''
as $remove$
declare
  v_list text[];
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_count integer;
begin
  if auth.uid() is null or p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select w.document_categories into v_list from public.app_workspaces w where w.id = p_workspace_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if p_name is null or not (p_name = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  if p_name = '기타' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_LOCKED');
  end if;
  if pg_catalog.cardinality(v_stored) > 50
     or exists (select 1 from pg_catalog.unnest(v_stored) as s(value) where s.value is null or s.value = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  update public.app_workspaces set document_categories = pg_catalog.array_remove(document_categories, p_name)
    where id = p_workspace_id;
  update public.app_documents set category = '기타', updated_at = pg_catalog.now()
    where workspace_id = p_workspace_id and category = any (pg_catalog.array_append(v_stored, p_name));
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_remove(v_list, p_name), 'documents', v_count);
exception when insufficient_privilege then
  return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$remove$;
revoke all on function public.app_document_category_delete(uuid, text, text[]) from public, anon;
grant execute on function public.app_document_category_delete(uuid, text, text[]) to authenticated;

-- 사후 확인: 권한 경계가 그대로이고 기존 자료에 조직 연결이 없으며 모든 workspace가 기본 7개인지 확인. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_documents'::regclass, 'public.app_workspaces'::regclass) and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_documents'::regclass, 'public.app_workspaces'::regclass) and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_workspaces'::regclass) <> 1
     or exists (select 1 from public.app_documents where organization_id is not null)
     or exists (select 1 from public.app_workspaces
         where document_categories is distinct from array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[]) then
    raise exception 'DOC_ORG_CATEGORIES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261018023753', 'doc_org_categories', array['UI-바구니첨부메모 PR 2: app_documents.organization_id + owner check, app_workspaces.document_categories + INVOKER category functions']);
commit;
