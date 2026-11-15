-- SELECT only. pg_catalog·migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤(또는 dry-run 뒤)에도 모두 예(기록·함수·색인이 함께 원래대로).
with fn as (select to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') as n,to_regprocedure('public.app_cloud_find(text,text,integer)') as o),
ix as (select to_regclass('public.app_cloud_items_recent_src_idx') as r,to_regclass('public.app_cloud_items_big_src_idx') as b,
  to_regclass('public.app_documents_workspace_file_idx') as d),
history as (select count(*) as n,count(*) filter(where name='cloud_find_sources') as named from supabase_migrations.schema_migrations where version='20261104120000')
select 'history, new function and indexes agree' as item,case when
  (history.n=0 and fn.n is null and ix.r is null and ix.b is null and ix.d is null)
  or (history.n=1 and history.named=1 and fn.n is not null and ix.r is not null and ix.b is not null and ix.d is not null)
  then '예' else '아니오' end as ok
  from fn,ix,history
union all select 'new function: definer, fixed search_path, authenticated only',case when (select n from fn) is null or exists(select 1 from pg_proc
  where oid=(select n from fn) and prosecdef and proconfig=array['search_path=""'] and not has_function_privilege('anon',oid,'execute')
    and not has_function_privilege('service_role',oid,'execute') and has_function_privilege('authenticated',oid,'execute') and proacl::text !~ '(^|[{,])=') then '예' else '아니오' end
union all select 'old signature: invoker, authenticated only',case when exists(select 1 from pg_proc where oid=(select o from fn) and not prosecdef
  and not has_function_privilege('anon',oid,'execute') and has_function_privilege('authenticated',oid,'execute') and proacl::text !~ '(^|[{,])=') then '예' else '아니오' end
union all select 'cloud tables: RLS on, one owner read policy each, authenticated select only, anon nothing',case when
  (select count(*) from pg_class where oid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars')) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_items'))=1 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_stars'))=1
  and not has_table_privilege('authenticated','public.app_cloud_items','insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_cloud_stars','insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon','public.app_cloud_items','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_cloud_stars','select,insert,update,delete') then '예' else '아니오' end
union all select 'documents: RLS on, no anon',case when (select relrowsecurity from pg_class where oid=to_regclass('public.app_documents'))
  and not has_table_privilege('anon','public.app_documents','select,insert,update,delete') then '예' else '아니오' end;
