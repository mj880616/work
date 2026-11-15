-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·허용 행·검사가 함께 원래대로).
with t as (select to_regclass('public.app_gdrive_sync') as s,to_regclass('public.app_gdrive_folders') as f,to_regclass('public.app_gdrive_photos') as p,
  to_regclass('public.app_operator_features') as o),
history as (select count(*) filter(where name='gdrive_photo_index') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261031120000'),
feat as (select count(*) filter(where feature='gdrive_photos') as g,
  count(*) filter(where feature='gdrive_photos' and workspace_id in (select workspace_id from public.app_operator_features where feature='calls')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ 'gdrive_photos') as with_g,count(*) as n from pg_constraint
  where conrelid=(select o from t) and conname='app_operator_features_feature_check')
select 'tables, feature row, check and history agree' as item,case when
  (history.n=0 and t.s is null and t.f is null and t.p is null and feat.g=0 and chk.n=1 and chk.with_g=0)
  or (history.n=1 and history.named=1 and t.s is not null and t.f is not null and t.p is not null and feat.g=1 and feat.same=1 and chk.n=1 and chk.with_g=1)
  then '예' else '아니오' end as ok
  from t,history,feat,chk
union all select 'RLS on and no policy on new tables and operator table',case when (select f from t) is null or (
  (select count(*) from pg_class where oid in ((select s from t),(select f from t),(select p from t),(select o from t)) and relrowsecurity)=4
  and not exists(select 1 from pg_policy where polrelid in ((select s from t),(select f from t),(select p from t),(select o from t)))) then '예' else '아니오' end
union all select 'authenticated and anon have nothing',case when (select f from t) is null or not exists(
  select 1 from unnest(array[(select s from t),(select f from t),(select p from t),(select o from t)]) x(r), unnest(array['authenticated','anon']) y(role)
  where has_table_privilege(y.role,x.r,'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege(y.role,x.r,'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when not exists(select 1 from pg_class where oid in ((select s from t),(select f from t),(select p from t),(select o from t))
  and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'service_role: four privileges on new tables only',case when (select f from t) is null or (
  not exists(select 1 from unnest(array[(select s from t),(select f from t),(select p from t)]) x(r)
    where not has_table_privilege('service_role',x.r,'select') or not has_table_privilege('service_role',x.r,'insert')
       or not has_table_privilege('service_role',x.r,'update') or not has_table_privilege('service_role',x.r,'delete')
       or has_table_privilege('service_role',x.r,'truncate,references,trigger'))
  and not has_table_privilege('service_role',(select o from t),'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end;
