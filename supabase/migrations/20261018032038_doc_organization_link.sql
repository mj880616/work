begin;
-- UI-바구니첨부메모 PR 2a(2026-10-18 커맨드센터 결정): 자료를 담당조직에 붙이는 칸만 추가한다.
-- app_documents.organization_id: 비어 있어도 됨, 조직이 지워지면 연결만 비움. 기존 owner 쓰기 검사에
-- "같은 workspace의 조직" 확인만 더한다(USING·역할·RLS는 그대로).
-- 분류 목록 저장(옛 20261018023753, 운영 미적용·폐기)은 이 migration에 넣지 않는다.
-- 새 함수·표 grant·새 정책·RLS 끄기·기존 행 변경·Edge 변경 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 고쳐서 통과시키지 않는다).
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261012100000' and name = 'basket_link_view_db') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version in ('20261018032038', '20261018023753'))
     or to_regclass('public.app_suborganizations') is null
     or not exists (select 1 from pg_proc
         where proname = 'app_is_workspace_owner' and pronamespace = 'private'::regnamespace)
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_documents'::regclass and not attisdropped and attname = 'organization_id')
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity)
     -- anon 또는 PUBLIC 표 권한이 있으면 멈춘다.
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_documents' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     or exists (select 1 from pg_class
         where relnamespace = 'public'::regnamespace and relname = 'app_documents_organization_idx') then
    raise exception 'DOC_ORGANIZATION_LINK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 자료 → 담당조직. 하나의 자료는 조직 하나(프로젝트 칸과 같은 모양).
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

-- 사후 확인: 권한 경계가 그대로이고 기존 자료에 조직 연결이 없는지 확인. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or exists (select 1 from public.app_documents where organization_id is not null) then
    raise exception 'DOC_ORGANIZATION_LINK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261018032038', 'doc_organization_link', array['UI-바구니첨부메모 PR 2a: app_documents.organization_id + same-workspace organization in owner WITH CHECK']);
commit;
