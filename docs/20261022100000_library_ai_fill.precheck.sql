-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no document text.
-- 적용 전 기대: 아래에 없는 항목은 모두 예. documents rows·hash는 값만 남기고 적용 뒤 postcheck에서 같은 값인지 본다.
-- expect: recent migrations = 기록
-- expect: extraction status constraint = 기록
-- expect: documents rows = 기록
-- expect: documents values hash = 기록
-- expect: documents grants hash = 기록
-- expect: documents policies hash = 기록
-- expect: documents triggers hash = 기록
-- expect: anon or public documents privilege = 아니오
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022100000') then '예' else '아니오' end as value
union all select 'prerequisite recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261018032038' and name='doc_organization_link')=1 then '예' else '아니오' end
union all select 'text columns to reuse present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_documents') and not attisdropped
  and ((attname='extracted_text' and atttypid='text'::regtype) or (attname='extraction_status' and atttypid='text'::regtype)
    or (attname='extraction_error' and atttypid='text'::regtype) or (attname='extracted_at' and atttypid='timestamptz'::regtype)))=4 then '예' else '아니오' end
union all select 'extraction status constraint',coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),' / ' order by conname) from pg_constraint where conrelid=to_regclass('public.app_documents') and pg_get_constraintdef(oid) like '%extraction%'),'none')
union all select 'field origin column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='field_origin' and not attisdropped) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'documents owner policy only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'anon or public documents privilege',case when has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated can update documents',case when has_table_privilege('authenticated','public.app_documents','update') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,d.project_id,d.organization_id),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
