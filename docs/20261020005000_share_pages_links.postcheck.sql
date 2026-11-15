-- SELECT only. Works after apply (all 예) and after rollback (history/tables absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_share_pages') as pages, to_regclass('public.app_share_page_links') as links
), history as (
  select count(*) filter(where name='share_pages_links') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261020005000'
)
select 'tables and history agree' as item,case when
  (history.n=0 and t.pages is null and t.links is null) or (history.n=1 and history.named=1 and t.pages is not null and t.links is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled on both',case when (select pages from t) is null or not exists(select 1 from pg_class where oid in((select pages from t),(select links from t)) and not relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy each',case when (select pages from t) is null or (
  (select count(*) from pg_policy where polrelid=(select pages from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select links from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid in((select pages from t),(select links from t)))=2) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select pages from t) is null or (
  not has_table_privilege('anon',(select pages from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select links from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select pages from t),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select links from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select pages from t) is null or not exists(select 1 from pg_class where oid in((select pages from t),(select links from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'service_role cannot read raw link value',case when (select links from t) is null or (
  not has_column_privilege('service_role',(select links from t),'token','select')
  and not has_column_privilege('service_role',(select links from t),'workspace_id','select')
  and not has_column_privilege('service_role',(select pages from t),'workspace_id','select')
  and has_column_privilege('service_role',(select links from t),'token_hash','select')
  and not has_table_privilege('service_role',(select pages from t),'insert,update,delete')
  and not has_table_privilege('service_role',(select links from t),'insert,update,delete')) then '예' else '아니오' end
union all select 'authenticated cannot write token columns',case when (select links from t) is null or (
  not has_column_privilege('authenticated',(select links from t),'token','insert')
  and not has_column_privilege('authenticated',(select links from t),'token','update')
  and not has_column_privilege('authenticated',(select links from t),'page_id','update')
  and not has_column_privilege('authenticated',(select pages from t),'workspace_id','update')) then '예' else '아니오' end;
