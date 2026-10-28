-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_ai_external_usage') as u,to_regclass('public.app_ai_cost_entries') as c),
history as (select count(*) filter(where name='ai_usage_costs') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261028160000')
select 'tables and history agree' as item,case when
  (history.n=0 and t.u is null and t.c is null) or (history.n=1 and history.named=1 and t.u is not null and t.c is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 + 3 owner policies for authenticated only',case when (select u from t) is null or (
  (select count(*) from pg_class where oid in ((select u from t),(select c from t)) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid=(select u from t))=1
  and (select count(*) from pg_policy where polrelid=(select c from t))=3
  and not exists(select 1 from pg_policy where polrelid in ((select u from t),(select c from t)) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'anon and PUBLIC have nothing',case when (select u from t) is null or (
  not has_table_privilege('anon',(select u from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select u from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select c from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select c from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select u from t),(select c from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: usage read only, entries read/insert/delete',case when (select u from t) is null or (
  has_table_privilege('authenticated',(select u from t),'select')
  and not has_table_privilege('authenticated',(select u from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select u from t),'insert,update,references')
  and has_table_privilege('authenticated',(select c from t),'select') and has_table_privilege('authenticated',(select c from t),'delete')
  and has_column_privilege('authenticated',(select c from t),'amount_krw','insert')
  and not has_column_privilege('authenticated',(select c from t),'id','insert')
  and not has_any_column_privilege('authenticated',(select c from t),'update,references')
  and not has_table_privilege('authenticated',(select c from t),'update,truncate,references,trigger')) then '예' else '아니오' end
union all select 'service_role: usage column insert only, no entries access',case when (select u from t) is null or (
  has_column_privilege('service_role',(select u from t),'ref','insert')
  and not has_column_privilege('service_role',(select u from t),'created_at','insert')
  and not has_table_privilege('service_role',(select u from t),'select,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select c from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select c from t),'select,insert,update,references')) then '예' else '아니오' end;
