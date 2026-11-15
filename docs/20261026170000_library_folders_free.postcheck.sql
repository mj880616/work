-- SELECT only. Works after apply (all 예) and after rollback (all 예 by the old shape). The shape that must hold follows the migration history row.
with history as (
  select count(*) filter(where name='library_folders_free') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261026170000'
), shape as (
  select (history.n=1 and history.named=1) as applied, (history.n=0) as reverted from history
)
select 'history agrees with the function and policy shape' as item,case when
  (select applied from shape) and (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and prosrc not like '%project_id%')=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items') and pg_get_expr(polwithcheck,polrelid) not like '%project_id%')=1
  or (select reverted from shape) and (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and prosrc like '%f.project_id is not distinct from new.project_id%')=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items') and pg_get_expr(polwithcheck,polrelid) like '%d.project_id IS DISTINCT FROM f.project_id%')=1
  then '예' else '아니오' end as ok
union all select 'one authenticated owner policy on folder items (owner and same workspace)',case when
  (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items') and polname='library_folder_items_owner_all' and polroles=array['authenticated'::regrole]::oid[] and polcmd='*'
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%d.workspace_id = app_library_folder_items.workspace_id%'
     and pg_get_expr(polwithcheck,polrelid) like '%f.workspace_id = app_library_folder_items.workspace_id%')=1 then '예' else '아니오' end
union all select 'two invoker trigger functions with no execute grant',case when
  (select count(*) from pg_proc where oid in(to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('private.app_library_folder_lift()'))
     and not prosecdef and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=')=2
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete'))=2 then '예' else '아니오' end
union all select 'RLS enabled on both tables',case when (select count(*) from pg_class where oid in(to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'anon and service_role have no table or column privilege',case when
  not has_table_privilege('anon',to_regclass('public.app_library_folders'),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',to_regclass('public.app_library_folders'),'select,insert,update,references')
  and not has_table_privilege('anon',to_regclass('public.app_library_folder_items'),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',to_regclass('public.app_library_folder_items'),'select,insert,update,references')
  and not has_table_privilege('service_role',to_regclass('public.app_library_folders'),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',to_regclass('public.app_library_folders'),'select,insert,update,references')
  and not has_table_privilege('service_role',to_regclass('public.app_library_folder_items'),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',to_regclass('public.app_library_folder_items'),'select,insert,update,references') then '예' else '아니오' end
union all select 'no PUBLIC grant',case when not exists(select 1 from pg_class where oid in(to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items')) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'project and workspace of a folder still cannot be changed',case when
  not has_column_privilege('authenticated',to_regclass('public.app_library_folders'),'project_id','update')
  and not has_column_privilege('authenticated',to_regclass('public.app_library_folders'),'workspace_id','update')
  and has_column_privilege('authenticated',to_regclass('public.app_library_folders'),'parent_id','update')
  and not has_column_privilege('authenticated',to_regclass('public.app_library_folder_items'),'document_id','update')
  and not has_column_privilege('authenticated',to_regclass('public.app_library_folder_items'),'workspace_id','update')
  and has_column_privilege('authenticated',to_regclass('public.app_library_folder_items'),'folder_id','update') then '예' else '아니오' end
union all select 'documents table untouched (one owner policy)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents') and polname='task12a_owner_all')=1 then '예' else '아니오' end;
