begin;
-- UI-바구니첨부메모 PR 2b(2026-10-18 사용자 결정 B-1): 자료 분류 목록을 내 프로필(app_profiles) 칸 하나에 저장.
-- 옛 20261018023753(운영 미적용·폐기)의 분류 부분을 app_workspaces 대신 app_profiles로 옮겼다.
-- 1) app_profiles.document_categories: 기본 7개(교섭·투쟁·교육·선전·정책·회의·기타). 검사 조건은 함수 없이 표 안에 둔다.
--    1~30개, 이름 1~20자(앞뒤 공백·제어문자·쉼표 없음), 겹침 없음, '기타'는 늘 있음(지우기·이름 바꾸기 불가).
-- 2) 추가·이름 바꾸기·삭제 함수 3개: SECURITY INVOKER, search_path 비움, 대상은 auth.uid()의 내 프로필 행뿐.
--    이름 바꾸기는 그 분류 자료도 새 이름으로, 삭제는 그 분류 자료를 '기타'로(같은 트랜잭션, 기존 owner RLS 그대로).
-- 표 grant·정책·RLS 변경, 기존 값 변경, Edge 변경 없음. 기존 표 UPDATE 권한과 owner 정책이 지금 모양일 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 넓혀서 통과시키지 않는다).
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261018032038' and name = 'doc_organization_link') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version in ('20261018112943', '20261018023753'))
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'document_categories')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_profiles_document_categories_check')
     or exists (select 1 from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('app_document_category_add', 'app_document_category_rename', 'app_document_category_delete'))
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     -- 정책은 task12a 두 개 그대로: 쓰기는 owner 검사 하나(자기 행 포함), 읽기는 자기 행.
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_profileuser_id') <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1
     -- owner 검사 함수가 task12a 원문 그대로여야 "내 행은 쓰기 허용"이 성립한다.
     or (select count(*) from pg_proc
         where pronamespace = 'private'::regnamespace and proname = 'app_is_owner_profile' and prosecdef
           and regexp_replace(prosrc, '\s', '', 'g') = 'selectexists(select1frompublic.app_workspace_memberssubjectjoinpublic.app_workspace_membersowneronowner.workspace_id=subject.workspace_idandowner.role=''owner''andowner.user_id=(selectauth.uid())wheresubject.user_id=p_user)') <> 1
     -- 소유자 본인의 프로필 행이 있다(그 행은 위 owner 검사를 통과한다).
     or not exists (select 1 from public.app_profiles p
         join public.app_workspace_members m on m.user_id = p.user_id and m.role = 'owner')
     -- 분류를 바꿀 자료 표: 분류 칸 있음, RLS 켜짐, owner 정책 하나(2a 적용 뒤 모양).
     or not exists (select 1 from pg_attribute
         where attrelid = 'public.app_documents'::regclass and not attisdropped and attname = 'category' and atttypid = 'text'::regtype)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1 then
    raise exception 'DOC_CATEGORIES_PROFILE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 분류 목록. 기존 행은 기본 7개로 채워진다(표를 다시 쓰지 않는 기본값).
alter table public.app_profiles
  add column document_categories text[] not null
    default array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[];
alter table public.app_profiles
  add constraint app_profiles_document_categories_check check (
    array_ndims(document_categories) = 1
    and array_lower(document_categories, 1) = 1
    and cardinality(document_categories) between 1 and 30
    and array_position(document_categories, null) is null
    and array_position(document_categories, '기타') is not null
    -- 쉼표로 이어 붙여 검사: 쉼표가 든 이름은 칸 수가 달라져 걸린다.
    and cardinality(document_categories) = cardinality(string_to_array(array_to_string(document_categories, ','), ','))
    -- 이름마다 1~20자, 앞뒤 공백·제어문자 없음.
    and array_to_string(document_categories, ',')
      ~ '^[^,[:cntrl:][:space:]]([^,[:cntrl:]]{0,18}[^,[:cntrl:][:space:]])?(,[^,[:cntrl:][:space:]]([^,[:cntrl:]]{0,18}[^,[:cntrl:][:space:]])?)*$'
    -- 같은 이름 두 번 금지.
    and array_to_string(document_categories, ',') !~ '(^|,)([^,]+),(.*,)?\2(,|$)'
  );

-- 2) 분류 추가: 목록 끝에 하나. 대상은 내 프로필 행뿐(owner RLS가 그대로 적용된다).
create function public.app_document_category_add(p_name text) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $add$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_name text := pg_catalog.btrim(p_name);
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if v_name is null or v_name = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  if v_name = any (v_list) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_EXISTS');
  end if;
  update public.app_profiles set document_categories = pg_catalog.array_append(document_categories, v_name)
    where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_append(v_list, v_name));
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$add$;
revoke all on function public.app_document_category_add(text) from public, anon, service_role;
grant execute on function public.app_document_category_add(text) to authenticated;

-- 이름 바꾸기: 목록의 이름과 그 분류 자료(내 업무공간)를 한 트랜잭션에서 바꾼다. '기타'는 잠금.
-- p_stored: 화면에서 이 분류로 보이던 예전 저장 값(예: 정부자료). 지금 목록에 있는 이름은 받지 않는다.
create function public.app_document_category_rename(p_from text, p_to text, p_stored text[]) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $rename$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_to text := pg_catalog.btrim(p_to);
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_count integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if p_from is null or not (p_from = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  if p_from = '기타' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_LOCKED');
  end if;
  if v_to is null or v_to = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  if v_to = p_from then
    return pg_catalog.jsonb_build_object('ok', true, 'categories', v_list, 'documents', 0);
  end if;
  if v_to = any (v_list) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_EXISTS');
  end if;
  if pg_catalog.cardinality(v_stored) > 50
     or pg_catalog.array_position(v_stored, null) is not null
     or v_stored && v_list then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  update public.app_profiles set document_categories = pg_catalog.array_replace(document_categories, p_from, v_to)
    where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  update public.app_documents set category = v_to
    where category = any (pg_catalog.array_append(v_stored, p_from))
      and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_replace(v_list, p_from, v_to), 'documents', v_count);
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$rename$;
revoke all on function public.app_document_category_rename(text, text, text[]) from public, anon, service_role;
grant execute on function public.app_document_category_rename(text, text, text[]) to authenticated;

-- 삭제: 목록에서 빼고 그 분류 자료(내 업무공간)는 '기타'로. '기타'는 지울 수 없다.
create function public.app_document_category_delete(p_name text, p_stored text[]) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $remove$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_count integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if p_name is null or not (p_name = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  if p_name = '기타' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_LOCKED');
  end if;
  if pg_catalog.cardinality(v_stored) > 50
     or pg_catalog.array_position(v_stored, null) is not null
     or v_stored && v_list then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  update public.app_profiles set document_categories = pg_catalog.array_remove(document_categories, p_name)
    where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  update public.app_documents set category = '기타'
    where category = any (pg_catalog.array_append(v_stored, p_name))
      and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_remove(v_list, p_name), 'documents', v_count);
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$remove$;
revoke all on function public.app_document_category_delete(text, text[]) from public, anon, service_role;
grant execute on function public.app_document_category_delete(text, text[]) to authenticated;

-- 사후 확인: 권한 경계가 그대로이고, 모든 프로필이 기본 7개이며, 함수 3개가 INVOKER·anon/PUBLIC 실행 불가인지. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or exists (select 1 from public.app_profiles
         where document_categories is distinct from array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[])
     or (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('app_document_category_add', 'app_document_category_rename', 'app_document_category_delete')
           and not prosecdef and proconfig = array['search_path=""']
           and proacl::text !~ '(^|[{,])(anon|service_role)?='
           and proacl::text ~ '(^|[{,])authenticated=X/') <> 3 then
    raise exception 'DOC_CATEGORIES_PROFILE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261018112943', 'doc_categories_profile', array['UI-바구니첨부메모 PR 2b: app_profiles.document_categories + CHECK, INVOKER add/rename/delete category functions (own profile only)']);
commit;
