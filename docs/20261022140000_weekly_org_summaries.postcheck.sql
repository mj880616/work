-- SELECT only. Works after apply (all 예) and after rollback (history/table absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_weekly_org_summaries') as s
), history as (
  select count(*) filter(where name='weekly_org_summaries') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261022140000'
)
select 'table and history agree' as item,case when
  (history.n=0 and t.s is null) or (history.n=1 and history.named=1 and t.s is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled',case when (select s from t) is null or exists(select 1 from pg_class where oid=(select s from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select s from t) is null or (
  (select count(*) from pg_policy where polrelid=(select s from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select s from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select s from t) is null or (
  not has_table_privilege('anon',(select s from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select s from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'service_role has no table or column privilege',case when (select s from t) is null or (
  not has_table_privilege('service_role',(select s from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select s from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select s from t) is null or not exists(select 1 from pg_class where oid=(select s from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated cannot move a summary to another week or organization',case when (select s from t) is null or (
  not has_column_privilege('authenticated',(select s from t),'week_start','update')
  and not has_column_privilege('authenticated',(select s from t),'organization_id','update')
  and not has_column_privilege('authenticated',(select s from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select s from t),'summary','update')) then '예' else '아니오' end
union all select 'no full text column',case when (select s from t) is null or not exists(select 1 from pg_attribute where attrelid=(select s from t) and attname in('raw_text','text','body','source_text') and not attisdropped) then '예' else '아니오' end;
