-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no document text.
-- 적용 전 기대: 아래 expect가 없는 항목은 모두 예. 자료 수·해시는 값만 남기고 적용 뒤 postcheck에서 같은 값인지 본다(기존 자료 값이 그대로인지).
-- expect: recent migrations = 기록
-- expect: documents rows = 기록
-- expect: documents values hash = 기록
-- expect: documents grants hash = 기록
-- expect: documents policies hash = 기록
-- expect: documents triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022212757') then '예' else '아니오' end as value
union all select 'library ai fill recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261022100000' and name='library_ai_fill')=1 then '예' else '아니오' end
union all select 'tidy backups table absent',case when to_regclass('public.app_library_tidy_backups') is null then '예' else '아니오' end
union all select 'tidy attempts table absent',case when to_regclass('public.app_library_tidy_attempts') is null then '예' else '아니오' end
union all select 'tidy apply function absent',case when to_regprocedure('public.app_library_auto_tidy_apply(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'tidy revert function absent',case when to_regprocedure('public.app_library_auto_tidy_revert(uuid)') is null then '예' else '아니오' end
union all select 'field origin column present',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='field_origin' and not attisdropped) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'authenticated can update documents',case when has_table_privilege('authenticated','public.app_documents','update') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,(to_jsonb(d)->'field_origin')::text),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
