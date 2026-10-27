begin;
-- 20261018032038_doc_organization_link의 짝 되돌리기. 칸·색인만 지우고 app_documents owner 검사를 원래 모양으로 돌린다.
-- 자료에 조직 연결이 한 건이라도 있으면 멈춘다. 데이터를 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면(PR 3)을 되돌리고, 연결을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261018032038' and name = 'doc_organization_link') <> 1 then
    raise exception 'DOC_ORGANIZATION_LINK_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_documents where organization_id is not null) then
    raise exception 'DOC_ORGANIZATION_LINK_ROLLBACK_BLOCKED: documents linked to organizations; preserve and plan recovery';
  end if;
end
$$;

-- task12a_sole_owner_db의 owner 검사 원문으로 되돌린다.
alter policy task12a_owner_all on public.app_documents
  with check (private.app_is_workspace_owner(workspace_id));
drop index public.app_documents_organization_idx;
alter table public.app_documents drop column organization_id;

delete from supabase_migrations.schema_migrations
  where version = '20261018032038' and name = 'doc_organization_link';
commit;
