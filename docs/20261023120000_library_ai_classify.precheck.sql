-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no document text.
-- 적용 전 기대: 아래 expect가 없는 항목은 모두 예. 자료 수·해시는 값만 남기고 적용 뒤 postcheck에서 같은 값인지 본다(기존 자료 값·권한·정책이 그대로인지).
-- expect: recent migrations = 기록
-- expect: documents rows = 기록
-- expect: documents values hash = 기록
-- expect: documents grants hash = 기록
-- expect: documents policies hash = 기록
-- expect: documents triggers hash = 기록
-- expect: tidy backups rows = 기록
-- expect: tidy backups values hash = 기록
-- expect: field origin check definition = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023120000') then '예' else '아니오' end as value
union all select 'library auto tidy recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261022212757' and name='library_auto_tidy')=1 then '예' else '아니오' end
union all select 'classify attempts table absent',case when to_regclass('public.app_library_classify_attempts') is null then '예' else '아니오' end
union all select 'classify apply function absent',case when to_regprocedure('public.app_library_classify_apply(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'classify revert function absent',case when to_regprocedure('public.app_library_classify_revert(uuid)') is null then '예' else '아니오' end
union all select 'classify revert since function absent',case when to_regprocedure('public.app_library_classify_revert_since(timestamptz)') is null then '예' else '아니오' end
union all select 'tidy backups table present',case when to_regclass('public.app_library_tidy_backups') is not null then '예' else '아니오' end
union all select 'field origin check present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_documents') and conname='app_documents_field_origin_check') then '예' else '아니오' end
union all select 'backup field check present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_library_tidy_backups') and conname='app_library_tidy_backups_field_check') then '예' else '아니오' end
union all select 'no link keys in field origin yet',case when not exists(select 1 from public.app_documents where (to_jsonb(app_documents)->'field_origin') ?| array['project_id','organization_id']) then '예' else '아니오' end
union all select 'project status column',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='status' and not attisdropped) then '예' else '아니오' end
union all select 'organization active column',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and attname='active' and not attisdropped) then '예' else '아니오' end
union all select 'authenticated can read projects',case when has_table_privilege('authenticated','public.app_spaces','select') then '예' else '아니오' end
union all select 'authenticated can read organizations',case when has_table_privilege('authenticated','public.app_suborganizations','select') then '예' else '아니오' end
union all select 'documents workspace trigger',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_documents') and tgname='app_documents_workspace_consistency' and tgenabled<>'D') then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'authenticated can update documents',case when has_table_privilege('authenticated','public.app_documents','update') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,d.project_id,d.organization_id,(to_jsonb(d)->'field_origin')::text),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'tidy backups rows',count(*)::text from public.app_library_tidy_backups
union all select 'tidy backups values hash',md5(coalesce(string_agg(concat_ws('|',b.id,b.field,b.old_value,b.new_value,b.reverted_at),E'\n' order by b.id),'')) from public.app_library_tidy_backups b
union all select 'field origin check definition',md5(coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_documents') and conname='app_documents_field_origin_check'),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
