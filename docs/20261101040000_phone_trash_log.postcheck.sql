-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 원래대로).
with t as (select to_regclass('public.app_phone_trash_log') as l),
history as (select count(*) filter(where name='phone_trash_log') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261101040000')
select 'table and history agree' as item,case when
  (history.n=0 and t.l is null) or (history.n=1 and history.named=1 and t.l is not null)
  then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on and one authenticated owner select policy',case when (select l from t) is null or (
  (select relrowsecurity from pg_class where oid=(select l from t))
  and (select count(*) from pg_policy where polrelid=(select l from t))=1
  and (select count(*) from pg_policy where polrelid=(select l from t) and polcmd='r'
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=1) then '예' else '아니오' end
union all select 'anon has nothing and no PUBLIC grant',case when (select l from t) is null or (
  not has_table_privilege('anon',(select l from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select l from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select l from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated read only',case when (select l from t) is null or (
  has_table_privilege('authenticated',(select l from t),'select')
  and not has_table_privilege('authenticated',(select l from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select l from t),'insert,update,references')) then '예' else '아니오' end
union all select 'service_role: four privileges',case when (select l from t) is null or (
  has_table_privilege('service_role',(select l from t),'select,insert,update,delete')
  and not has_table_privilege('service_role',(select l from t),'truncate,references,trigger')) then '예' else '아니오' end;
