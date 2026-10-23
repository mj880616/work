-- SELECT only. Works after apply (all 예) and after rollback (history/table absent → first row 예, the rest 예 by absence).
with t as (select to_regclass('public.app_share_page_media') as media),
history as (select count(*) filter(where name='share_page_media') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261023110000')
select 'table and history agree' as item,case when
  (history.n=0 and t.media is null) or (history.n=1 and history.named=1 and t.media is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled',case when (select media from t) is null or exists(select 1 from pg_class where oid=(select media from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select media from t) is null or (
  (select count(*) from pg_policy where polrelid=(select media from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select media from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select media from t) is null or (
  not has_table_privilege('anon',(select media from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select media from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select media from t) is null or not exists(select 1 from pg_class where oid=(select media from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'service_role reads only id, page and path',case when (select media from t) is null or (
  has_column_privilege('service_role',(select media from t),'storage_path','select')
  and not has_column_privilege('service_role',(select media from t),'workspace_id','select')
  and not has_table_privilege('service_role',(select media from t),'insert,update,delete')) then '예' else '아니오' end
union all select 'authenticated cannot update',case when (select media from t) is null or (
  not has_table_privilege('authenticated',(select media from t),'update')
  and not has_any_column_privilege('authenticated',(select media from t),'update')) then '예' else '아니오' end;
