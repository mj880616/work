-- SELECT only. Works after apply (record + column + CHECK + 3 functions) and after rollback/dry-run (none of them).
-- Compare precheck hashes (rows, grants, policies, triggers) separately.
with history as (
  select count(*) as n,count(*) filter(where name='doc_categories_profile') as named from supabase_migrations.schema_migrations where version='20261018112943'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='document_categories' and not attisdropped
), checks as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_document_categories_check' and convalidated
), fns as (
  select count(*) as n,
    count(*) filter(where not prosecdef and proconfig=array['search_path=""'] and proacl::text !~ '(^|[{,])(anon|service_role)?=' and proacl::text ~ '(^|[{,])authenticated=X/') as safe
  from pg_proc where pronamespace='public'::regnamespace and proname in('app_document_category_add','app_document_category_rename','app_document_category_delete')
)
select 'column check functions and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0 and fns.n=0)
  or (history.n=1 and history.named=1 and cols.n=1 and checks.n=1 and fns.n=3 and fns.safe=3) then '예' else '아니오' end as ok
  from history,cols,checks,fns
union all select 'every profile has the default 7 categories (or no column)',case when not exists(select 1 from public.app_profiles p
  where to_jsonb(p) ? 'document_categories' and to_jsonb(p)->'document_categories' is distinct from '["교섭","투쟁","교육","선전","정책","회의","기타"]'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'anon cannot execute category functions',case when not exists(select 1 from pg_proc where pronamespace='public'::regnamespace
  and proname in('app_document_category_add','app_document_category_rename','app_document_category_delete') and has_function_privilege('anon',oid,'execute')) then '예' else '아니오' end;
