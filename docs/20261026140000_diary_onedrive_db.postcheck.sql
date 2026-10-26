-- SELECT only. Works after apply (all 예) and after rollback (history/tables absent → first row 예, the rest 예 by absence).
with t as (select to_regclass('public.app_onedrive_connections') as conn,to_regclass('public.app_diary_stars') as stars),
history as (select count(*) filter(where name='diary_onedrive_db') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261026140000')
select 'tables and history agree' as item,case when
  (history.n=0 and t.conn is null and t.stars is null) or (history.n=1 and history.named=1 and t.conn is not null and t.stars is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled on both',case when (select conn from t) is null or (select count(*) from pg_class where oid in ((select conn from t),(select stars from t)) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'connections: no policy and no authenticated privilege',case when (select conn from t) is null or (
  (select count(*) from pg_policy where polrelid=(select conn from t))=0
  and not has_table_privilege('authenticated',(select conn from t),'select,insert,update,delete,references,trigger')
  and not has_any_column_privilege('authenticated',(select conn from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'stars: one authenticated owner policy',case when (select stars from t) is null or (
  (select count(*) from pg_policy where polrelid=(select stars from t))=1
  and (select count(*) from pg_policy where polrelid=(select stars from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select conn from t) is null or (
  not has_table_privilege('anon',(select conn from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select conn from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select stars from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select stars from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select conn from t) is null or not exists(select 1 from pg_class where oid in ((select conn from t),(select stars from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'stars: authenticated cannot update, service_role has nothing',case when (select stars from t) is null or (
  not has_table_privilege('authenticated',(select stars from t),'update') and not has_any_column_privilege('authenticated',(select stars from t),'update')
  and not has_table_privilege('service_role',(select stars from t),'select,insert,update,delete')
  and not has_any_column_privilege('service_role',(select stars from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'connections: service_role reads and deletes, writes by column only',case when (select conn from t) is null or (
  has_table_privilege('service_role',(select conn from t),'select') and has_table_privilege('service_role',(select conn from t),'delete')
  and not has_table_privilege('service_role',(select conn from t),'insert,update')
  and has_column_privilege('service_role',(select conn from t),'refresh_token','update')
  and not has_column_privilege('service_role',(select conn from t),'workspace_id','update')) then '예' else '아니오' end;
