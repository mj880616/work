-- SELECT only. pg_catalog·migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·새 표·금액 표 검사가 함께 원래대로).
with t as (select to_regclass('public.app_ai_usage_events') as u,to_regclass('public.app_ai_cost_entries') as c),
history as (select count(*) filter(where name='ai_usage_events') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125235000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''reload''' and pg_get_constraintdef(oid) ~ '''cap''') as with_new,count(*) as n
  from pg_constraint where conrelid=(select c from t) and conname in ('app_ai_cost_entries_kind_check','app_ai_cost_entries_month_check'))
select 'new table, cost checks and history agree' as item,case when
  (history.n=0 and t.u is null and chk.n=2 and chk.with_new=0)
  or (history.n=1 and history.named=1 and t.u is not null and chk.n=2 and chk.with_new=2) then '예' else '아니오' end as ok
  from t,history,chk
union all select 'usage events: RLS on, 2 owner policies for authenticated only',case when (select u from t) is null or (
  (select relrowsecurity from pg_class where oid=(select u from t))
  and (select count(*) from pg_policy where polrelid=(select u from t))=2
  and (select count(*) from pg_policy where polrelid=(select u from t) and polcmd in ('r','a'))=2
  and not exists(select 1 from pg_policy where polrelid=(select u from t) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'usage events: anon and PUBLIC have nothing',case when (select u from t) is null or (
  not has_table_privilege('anon',(select u from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select u from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select u from t) and relacl::text ~ '(^|[{,])=')
  and not exists(select 1 from pg_attribute where attrelid=(select u from t) and attacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'usage events: authenticated read + column insert only',case when (select u from t) is null or (
  has_table_privilege('authenticated',(select u from t),'select')
  and has_column_privilege('authenticated',(select u from t),'feature','insert')
  and not has_column_privilege('authenticated',(select u from t),'id','insert')
  and not has_column_privilege('authenticated',(select u from t),'created_at','insert')
  and not has_table_privilege('authenticated',(select u from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select u from t),'update,references')) then '예' else '아니오' end
union all select 'usage events: service_role column insert only',case when (select u from t) is null or (
  has_column_privilege('service_role',(select u from t),'feature','insert')
  and not has_column_privilege('service_role',(select u from t),'id','insert')
  and not has_column_privilege('service_role',(select u from t),'created_at','insert')
  and not has_table_privilege('service_role',(select u from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select u from t),'select,update,references')) then '예' else '아니오' end
union all select 'usage events: no content columns',case when (select u from t) is null or not exists(select 1 from pg_attribute
  where attrelid=(select u from t) and attnum>0 and not attisdropped
  and attname not in ('id','workspace_id','day','feature','provider','model','calls','input_tokens','output_tokens','created_at')) then '예' else '아니오' end
union all select 'cost entries: grants and policies unchanged',case when
  (select count(*) from pg_policy where polrelid=(select c from t))=3
  and (select relrowsecurity from pg_class where oid=(select c from t))
  and not has_table_privilege('anon',(select c from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select c from t),'select,insert,update,references')
  and not has_any_column_privilege('authenticated',(select c from t),'update,references') then '예' else '아니오' end;
