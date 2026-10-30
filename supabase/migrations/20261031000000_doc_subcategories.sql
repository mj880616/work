begin;
-- LIB-소분류 DB (요청함 10/30 10:50, 명진 결정 "ㅇㅇ 다 넣어"). 자료 분류 안에 소분류를 둔다(담당조직 자료·자료실 공통).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- ★적용 순서: 주간보고 화면이 두 이름(옛 '주간보고 확정본'·새 '주간보고›확정본')을 모두 읽는 앱 PR이 먼저 배포된 뒤에 적용한다.★
--
-- 저장 모양(새 칸·새 표 없음): 내 분류 목록(app_profiles.document_categories)에 소분류를 '큰분류›소분류' 한 칸으로 둔다
--   (구분 글자 '›' U+203A). 자료의 분류 값도 '선전›투쟁속보'. 기존 검사(1~30개, 칸마다 1~20자, 쉼표 없음, 겹침 없음, '기타' 필수)는 그대로다.
--   소분류 추가는 기존 app_document_category_add로 한다(화면이 큰 분류가 목록에 있는지 먼저 본다). 소분류 이름 바꾸기는 기존 rename.
-- 새 함수 셋(SECURITY INVOKER, search_path 비움, 대상은 auth.uid()의 내 프로필 행과 내 업무공간 자료뿐 = 기존 owner RLS 그대로):
--   1) app_document_subcategory_delete(p_name): 소분류를 목록에서 빼고, 그 소분류 자료는 큰 분류로 남긴다(자료 보존).
--   2) app_document_category_rename_group(p_from,p_to,p_stored): 큰 분류 이름과 그 소분류 이름 앞부분, 자료 값을 한 번에 바꾼다.
--   3) app_document_category_delete_group(p_name,p_stored): 큰 분류와 소분류를 함께 빼고 그 자료는 '기타'로(기존 삭제와 같은 뜻).
-- 자료 이전(같은 트랜잭션): 목록에 '주간보고 확정본'·'주간보고 개인본'이 있는 프로필은 그 자리에 '주간보고'·'주간보고›확정본'·'주간보고›개인본'으로
--   바꾸고, 그 사람 업무공간 자료의 분류 값도 같은 이름으로 옮긴다(건수는 사후 확인이 전후 같음을 본다).
-- 권한: 표 grant·정책·RLS·트리거·검사 변경 없음. 새 함수는 authenticated만 실행(anon·PUBLIC·service_role 회수).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in share row exclusive mode;
lock table public.app_documents in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261018112943' and name = 'doc_categories_profile') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000000')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('app_document_subcategory_delete', 'app_document_category_rename_group', 'app_document_category_delete_group'))
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('app_document_category_add', 'app_document_category_rename', 'app_document_category_delete') and not prosecdef) <> 3
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     -- 이미 '›'가 든 분류(소분류)를 쓰는 프로필·자료가 없다.
     or exists (select 1 from public.app_profiles p, unnest(p.document_categories) c where pg_catalog.strpos(c, '›') > 0)
     or exists (select 1 from public.app_documents where pg_catalog.strpos(category, '›') > 0)
     -- 옛 주간보고 두 이름이 있는 프로필에 '주간보고'가 이미 따로 있지 않다(되돌리기에서 무엇을 뺄지 분명하게).
     or exists (select 1 from public.app_profiles p
         where p.document_categories && array['주간보고 확정본', '주간보고 개인본']::text[] and '주간보고' = any (p.document_categories)) then
    raise exception 'DOC_SUBCATEGORIES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 소분류 지우기: 목록에서 빼고 그 자료는 큰 분류로.
create function public.app_document_subcategory_delete(p_name text) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $subdel$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_parent text;
  v_count integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if p_name is null or pg_catalog.strpos(p_name, '›') = 0 or not (p_name = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  v_parent := pg_catalog.split_part(p_name, '›', 1);
  if not (v_parent = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  update public.app_profiles set document_categories = pg_catalog.array_remove(document_categories, p_name)
    where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  update public.app_documents set category = v_parent
    where category = p_name and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', pg_catalog.array_remove(v_list, p_name), 'documents', v_count);
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$subdel$;
revoke all on function public.app_document_subcategory_delete(text) from public, anon, service_role;
grant execute on function public.app_document_subcategory_delete(text) to authenticated;

-- 2) 큰 분류 이름 바꾸기(소분류 앞부분·자료 값까지 한 번에). p_stored: 이 큰 분류로 보이던 예전 저장 값(기존 rename과 같은 규칙).
create function public.app_document_category_rename_group(p_from text, p_to text, p_stored text[]) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $grename$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_new text[];
  v_to text := pg_catalog.btrim(p_to);
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_prefix text;
  v_count integer;
  v_more integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if p_from is null or pg_catalog.strpos(p_from, '›') > 0 or not (p_from = any (v_list)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_FOUND');
  end if;
  if p_from = '기타' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_LOCKED');
  end if;
  if v_to is null or v_to = '' or pg_catalog.strpos(v_to, '›') > 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  if v_to = p_from then
    return pg_catalog.jsonb_build_object('ok', true, 'categories', v_list, 'documents', 0);
  end if;
  v_prefix := p_from || '›';
  select pg_catalog.array_agg(case when c = p_from then v_to
      when pg_catalog.left(c, pg_catalog.length(v_prefix)) = v_prefix then v_to || '›' || pg_catalog.substr(c, pg_catalog.length(v_prefix) + 1)
      else c end order by n)
    into v_new from pg_catalog.unnest(v_list) with ordinality as t(c, n);
  -- 새 이름(큰 분류·소분류)이 바뀌지 않는 다른 칸과 겹치면 거절.
  if exists (select 1 from pg_catalog.unnest(v_new) x group by x having count(*) > 1) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CATEGORY_EXISTS');
  end if;
  if pg_catalog.cardinality(v_stored) > 50
     or pg_catalog.array_position(v_stored, null) is not null
     or v_stored && v_list then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  update public.app_profiles set document_categories = v_new where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  update public.app_documents set category = v_to
    where category = any (pg_catalog.array_append(v_stored, p_from))
      and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_count = row_count;
  update public.app_documents set category = v_to || '›' || pg_catalog.substr(category, pg_catalog.length(v_prefix) + 1)
    where pg_catalog.left(category, pg_catalog.length(v_prefix)) = v_prefix
      and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_more = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', v_new, 'documents', v_count + v_more);
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$grename$;
revoke all on function public.app_document_category_rename_group(text, text, text[]) from public, anon, service_role;
grant execute on function public.app_document_category_rename_group(text, text, text[]) to authenticated;

-- 3) 큰 분류 지우기(소분류 함께): 목록에서 빼고 그 자료는 '기타'로. '기타'는 지울 수 없다.
create function public.app_document_category_delete_group(p_name text, p_stored text[]) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $gdelete$
declare
  v_uid uuid := auth.uid();
  v_list text[];
  v_new text[];
  v_stored text[] := coalesce(p_stored, '{}'::text[]);
  v_prefix text;
  v_count integer;
begin
  if v_uid is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  select p.document_categories into v_list from public.app_profiles p where p.user_id = v_uid for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  if p_name is null or pg_catalog.strpos(p_name, '›') > 0 or not (p_name = any (v_list)) then
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
  v_prefix := p_name || '›';
  select coalesce(pg_catalog.array_agg(c order by n), '{}'::text[]) into v_new
    from pg_catalog.unnest(v_list) with ordinality as t(c, n)
    where c <> p_name and pg_catalog.left(c, pg_catalog.length(v_prefix)) <> v_prefix;
  update public.app_profiles set document_categories = v_new where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
  end if;
  update public.app_documents set category = '기타'
    where (category = any (pg_catalog.array_append(v_stored, p_name))
        or pg_catalog.left(category, pg_catalog.length(v_prefix)) = v_prefix)
      and private.app_is_workspace_owner(workspace_id);
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'categories', v_new, 'documents', v_count);
exception
  when check_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PERMISSION_DENIED');
end;
$gdelete$;
revoke all on function public.app_document_category_delete_group(text, text[]) from public, anon, service_role;
grant execute on function public.app_document_category_delete_group(text, text[]) to authenticated;

-- 4) 주간보고 합치기(자료 이전). 옛 두 이름 자리(앞의 것)에 '주간보고'와 있던 소분류를 넣고 옛 이름은 뺀다.
update public.app_profiles p
  set document_categories = (
    select pg_catalog.array_agg(x order by n, k)
    from (
      select c as x, n, 0 as k from pg_catalog.unnest(p.document_categories) with ordinality as t(c, n)
        where c not in ('주간보고 확정본', '주간보고 개인본')
      union all
      select v.x, (select min(n) from pg_catalog.unnest(p.document_categories) with ordinality as t(c, n)
          where c in ('주간보고 확정본', '주간보고 개인본')), v.k
        from (values ('주간보고', 1), ('주간보고›확정본', 2), ('주간보고›개인본', 3)) as v(x, k)
        where v.k = 1
           or (v.k = 2 and '주간보고 확정본' = any (p.document_categories))
           or (v.k = 3 and '주간보고 개인본' = any (p.document_categories))
    ) merged
  )
  where p.document_categories && array['주간보고 확정본', '주간보고 개인본']::text[];

-- 그 프로필 주인의 업무공간 자료만 옮긴다(소유자 연결 = app_workspace_members owner 행).
update public.app_documents d
  set category = case d.category when '주간보고 확정본' then '주간보고›확정본' else '주간보고›개인본' end
  where d.category in ('주간보고 확정본', '주간보고 개인본')
    and exists (select 1 from public.app_workspace_members m join public.app_profiles p on p.user_id = m.user_id
      where m.workspace_id = d.workspace_id and m.role = 'owner'
        and p.document_categories @> array[case d.category when '주간보고 확정본' then '주간보고›확정본' else '주간보고›개인본' end]::text[]);

-- 사후 확인: 함수 셋이 INVOKER·authenticated 전용이고, 옛 이름이 목록·옮긴 자료에 남지 않았는지. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('app_document_subcategory_delete', 'app_document_category_rename_group', 'app_document_category_delete_group')
        and not prosecdef and proconfig = array['search_path=""']
        and proacl::text !~ '(^|[{,])(anon|service_role)?='
        and proacl::text ~ '(^|[{,])authenticated=X/') <> 3
     or exists (select 1 from public.app_profiles where document_categories && array['주간보고 확정본', '주간보고 개인본']::text[])
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity) then
    raise exception 'DOC_SUBCATEGORIES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261031000000', 'doc_subcategories', array['LIB-소분류: INVOKER subcategory delete / group rename / group delete functions (own profile only) + merge 주간보고 확정본·개인본 into 주간보고 subcategories']);
commit;
