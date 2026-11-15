-- SELECT only. Works after apply (all 예) and after rollback (history/tables absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_library_folders') as f, to_regclass('public.app_library_folder_items') as i
), history as (
  select count(*) filter(where name='library_folders') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261022120000'
)
select 'tables and history agree' as item,case when
  (history.n=0 and t.f is null and t.i is null) or (history.n=1 and history.named=1 and t.f is not null and t.i is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled on both tables',case when (select f from t) is null or (
  exists(select 1 from pg_class where oid=(select f from t) and relrowsecurity) and exists(select 1 from pg_class where oid=(select i from t) and relrowsecurity)) then '예' else '아니오' end
union all select 'one authenticated owner policy on folders',case when (select f from t) is null or (
  (select count(*) from pg_policy where polrelid=(select f from t) and polroles=array['authenticated'::regrole]::oid[]
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%app_space_in_workspace(project_id, workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select f from t))=1) then '예' else '아니오' end
union all select 'one authenticated owner policy on folder items',case when (select i from t) is null or (
  (select count(*) from pg_policy where polrelid=(select i from t) and polroles=array['authenticated'::regrole]::oid[]
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select i from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select f from t) is null or (
  not has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select i from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select i from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role has no table or column privilege',case when (select f from t) is null or (
  not has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select i from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select i from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select f from t) is null or not exists(select 1 from pg_class where oid in((select f from t),(select i from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'folders: project and workspace cannot be changed',case when (select f from t) is null or (
  has_table_privilege('authenticated',(select f from t),'select') and has_table_privilege('authenticated',(select f from t),'delete')
  and has_column_privilege('authenticated',(select f from t),'name','update')
  and has_column_privilege('authenticated',(select f from t),'parent_id','update')
  and not has_column_privilege('authenticated',(select f from t),'project_id','update')
  and not has_column_privilege('authenticated',(select f from t),'workspace_id','update')
  and not has_column_privilege('authenticated',(select f from t),'id','insert')) then '예' else '아니오' end
union all select 'folder items: only the folder can be changed',case when (select i from t) is null or (
  has_table_privilege('authenticated',(select i from t),'select') and has_table_privilege('authenticated',(select i from t),'delete')
  and has_column_privilege('authenticated',(select i from t),'folder_id','update')
  and not has_column_privilege('authenticated',(select i from t),'document_id','update')
  and not has_column_privilege('authenticated',(select i from t),'workspace_id','update')) then '예' else '아니오' end
union all select 'two invoker trigger functions with no execute grant',case when (select f from t) is null or (
  (select count(*) from pg_proc where oid in(to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('private.app_library_folder_lift()'))
     and not prosecdef and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=')=2
  and (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=2) then '예' else '아니오' end;
