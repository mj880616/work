-- SELECT only. Works after apply (all 예) and after rollback (history/table absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_task_attachments') as att
), history as (
  select count(*) filter(where name='task_attachments') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261022003000'
)
select 'table and history agree' as item,case when
  (history.n=0 and t.att is null) or (history.n=1 and history.named=1 and t.att is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled',case when (select att from t) is null or exists(select 1 from pg_class where oid=(select att from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select att from t) is null or (
  (select count(*) from pg_policy where polrelid=(select att from t) and polroles=array['authenticated'::regrole]::oid[]
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%'
     and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select att from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select att from t) is null or (
  not has_table_privilege('anon',(select att from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select att from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role has no table or column privilege',case when (select att from t) is null or (
  not has_table_privilege('service_role',(select att from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select att from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select att from t) is null or not exists(select 1 from pg_class where oid=(select att from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated: select, insert columns, delete; no update',case when (select att from t) is null or (
  has_table_privilege('authenticated',(select att from t),'select')
  and has_table_privilege('authenticated',(select att from t),'delete')
  and has_column_privilege('authenticated',(select att from t),'drive_file_id','insert')
  and not has_column_privilege('authenticated',(select att from t),'id','insert')
  and not has_column_privilege('authenticated',(select att from t),'created_at','insert')
  and not has_any_column_privilege('authenticated',(select att from t),'update')) then '예' else '아니오' end
union all select 'attachments hold no file content column',case when (select att from t) is null or not exists(select 1 from pg_attribute where attrelid=(select att from t) and attname in('content','bytes','data','text','folder_id','token') and not attisdropped) then '예' else '아니오' end;
