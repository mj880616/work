begin;
-- 20261018023753_doc_org_categories의 짝 되돌리기. 칸·색인·검사 조건·함수만 지우고 app_documents owner 검사를 원래 모양으로 돌린다.
-- 자료에 조직 연결이 한 건이라도 있거나, 어떤 workspace의 분류 목록이 기본 7개와 다르면 멈춘다. 데이터를 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면(PR 3)을 되돌리고, 연결·목록을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
-- 이름 바꾸기·삭제로 이미 바뀐 자료의 분류 값은 되돌리지 않는다(그 값은 평범한 글자로 남는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_workspaces, public.app_documents in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261018023753' and name = 'doc_org_categories') <> 1 then
    raise exception 'DOC_ORG_CATEGORIES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_documents where organization_id is not null) then
    raise exception 'DOC_ORG_CATEGORIES_ROLLBACK_BLOCKED: documents linked to organizations; preserve and plan recovery';
  end if;
  if exists (select 1 from public.app_workspaces
      where document_categories is distinct from array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[]) then
    raise exception 'DOC_ORG_CATEGORIES_ROLLBACK_BLOCKED: category list edited; preserve and plan recovery';
  end if;
end
$$;

-- task12a_sole_owner_db의 owner 검사 원문으로 되돌린다.
alter policy task12a_owner_all on public.app_documents
  with check (private.app_is_workspace_owner(workspace_id));
drop index public.app_documents_organization_idx;
alter table public.app_documents drop column organization_id;
alter table public.app_workspaces
  drop constraint app_workspaces_document_categories_check,
  drop column document_categories;
drop function public.app_document_category_delete(uuid, text, text[]);
drop function public.app_document_category_rename(uuid, text, text, text[]);
drop function public.app_document_category_add(uuid, text);
drop function private.app_document_categories_valid(text[]);

delete from supabase_migrations.schema_migrations
  where version = '20261018023753' and name = 'doc_org_categories';
commit;
