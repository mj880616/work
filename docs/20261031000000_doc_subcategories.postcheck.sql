-- SELECT only. After apply: record + 3 functions + no old weekly names in lists. Hash/count items must equal the precheck values of the same name.
-- 'weekly documents to move'는 사후에 새 이름('주간보고›확정본'·'주간보고›개인본')으로 옮겨진 자료 수로 세어 사전 값과 같아야 한다(건수 전후 같음).
select 'history and functions agree' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261031000000' and name='doc_subcategories')=1
  and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('app_document_subcategory_delete','app_document_category_rename_group','app_document_category_delete_group')
    and not prosecdef and proconfig=array['search_path=""'] and proacl::text !~ '(^|[{,])(anon|service_role)?=' and proacl::text ~ '(^|[{,])authenticated=X/')=3 then '예' else '아니오' end as value
union all select 'old weekly names gone from lists',case when not exists(select 1 from public.app_profiles where document_categories && array['주간보고 확정본','주간보고 개인본']::text[]) then '예' else '아니오' end
union all select 'merge profiles',count(*)::text from public.app_profiles where document_categories && array['주간보고›확정본','주간보고›개인본']::text[]
union all select 'weekly documents to move',count(*)::text from public.app_documents where category in ('주간보고›확정본','주간보고›개인본')
union all select 'RLS enabled',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),'')) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),'')) from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),'')) from pg_constraint where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'documents rows',count(*)::text from public.app_documents;
