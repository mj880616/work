-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·허용 행·검사가 함께 원래대로).
with o as (select to_regclass('public.app_operator_features') as r),
history as (select count(*) filter(where name='arsenal_outside_features') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261113230000'),
feat as (select count(*) filter(where feature::text in ('arsenal','outside')) as k,
  count(*) filter(where feature::text in ('arsenal','outside') and workspace_id in (select workspace_id from public.app_operator_features where feature='calls')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''arsenal''' and pg_get_constraintdef(oid) ~ '''outside''') as with_k,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''ai_no_cap''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check')
select 'feature rows, check and history agree' as item,case when
  (history.n=0 and feat.k=0 and chk.n=1 and chk.with_k=0 and chk.with_prev=1)
  or (history.n=1 and history.named=1 and feat.k=2 and feat.same=2 and chk.n=1 and chk.with_k=1 and chk.with_prev=1)
  then '예' else '아니오' end as ok
  from history,feat,chk
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end;
