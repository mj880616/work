-- SELECT only. pg_catalog·migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤(또는 dry-run 뒤)에도 모두 예(기록·정책·함수가 함께 원래대로).
with pol as (select count(*) as n,
  count(*) filter(where pg_get_expr(p.polqual,p.polrelid)='private.app_is_workspace_owner(workspace_id)') as owner_only,
  count(*) filter(where strpos(pg_get_expr(p.polqual,p.polrelid),'app_is_workspace_owner(workspace_id)')>0
    and strpos(pg_get_expr(p.polqual,p.polrelid),'''files''')>0) as with_files,
  count(*) filter(where p.polcmd='r' and p.polpermissive and p.polwithcheck is null
    and p.polroles=array[(select oid from pg_roles where rolname='authenticated')]) as shape
  from pg_policy p where p.polname in ('cloud_items_owner_read','cloud_stars_owner_read','cloud_jobs_owner_read')
   and p.polrelid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),to_regclass('public.app_cloud_jobs'))),
fn as (select count(*) filter(where strpos(pg_get_functiondef(oid),'app_workspace_has_feature')>0) as with_files,count(*) as n
  from pg_proc where oid=to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')),
history as (select count(*) as n,count(*) filter(where name='cloud_files_all_owners') as named from supabase_migrations.schema_migrations where version='20261115120000')
select 'history, policies and function agree' as item,case when
  (history.n=0 and pol.n=3 and pol.with_files=3 and fn.n=1 and fn.with_files=1)
  or (history.n=1 and history.named=1 and pol.n=3 and pol.owner_only=3 and fn.n=1 and fn.with_files=0)
  then '예' else '아니오' end as ok
  from pol,fn,history
union all select 'read policies: select, permissive, authenticated only',case when (select shape from pol)=3 then '예' else '아니오' end
union all select 'cloud tables: RLS on, one policy each, no authenticated writes, no anon or PUBLIC',case when
  (select count(*) from pg_class where oid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),to_regclass('public.app_cloud_jobs')) and relrowsecurity
    and coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=')=3
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_items'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_stars'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_jobs'))=1
  and not has_table_privilege('authenticated','public.app_cloud_items','insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_cloud_stars','insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_cloud_jobs','insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon','public.app_cloud_items','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_cloud_stars','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_cloud_jobs','select,insert,update,delete') then '예' else '아니오' end
union all select 'find function: definer, fixed search_path, authenticated only',case when exists(select 1 from pg_proc
  where oid=to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') and prosecdef and proconfig=array['search_path=""']
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and has_function_privilege('authenticated',oid,'execute') and proacl::text !~ '(^|[{,])=') then '예' else '아니오' end;
