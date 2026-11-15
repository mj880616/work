-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·허용 행·검사가 함께 원래대로).
with o as (select to_regclass('public.app_operator_features') as r),
history as (select count(*) filter(where name='dev_inbox_feature') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261103100000'),
feat as (select count(*) filter(where feature='dev_inbox') as k,
  count(*) filter(where feature='dev_inbox' and workspace_id in (select workspace_id from public.app_operator_features where feature='calls')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ 'dev_inbox') as with_d,count(*) filter(where pg_get_constraintdef(oid) ~ '''files''') as with_f,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check')
select 'feature row, check and history agree' as item,case when
  (history.n=0 and feat.k=0 and chk.n=1 and chk.with_d=0 and chk.with_f=1)
  or (history.n=1 and history.named=1 and feat.k=1 and feat.same=1 and chk.n=1 and chk.with_d=1 and chk.with_f=1)
  then '예' else '아니오' end as ok
  from history,feat,chk
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end;
