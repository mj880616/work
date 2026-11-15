-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·칸이 함께 없음).
with t as (select to_regclass('public.app_onedrive_folders') as f,to_regclass('public.app_onedrive_photos') as p,to_regclass('public.app_onedrive_connections') as c),
history as (select count(*) filter(where name='onedrive_photo_index') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261028010000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select c from t) and not attisdropped and attname in ('delta_link','next_link','index_done_at','synced_at','index_lock_until'))
select 'tables, columns and history agree' as item,case when
  (history.n=0 and t.f is null and t.p is null and cols.n=0) or (history.n=1 and history.named=1 and t.f is not null and t.p is not null and cols.n=5) then '예' else '아니오' end as ok
  from t,history,cols
union all select 'RLS on and no policy on index tables',case when (select f from t) is null or (
  (select count(*) from pg_class where oid in ((select f from t),(select p from t)) and relrowsecurity)=2
  and not exists(select 1 from pg_policy where polrelid in ((select f from t),(select p from t),(select c from t)))) then '예' else '아니오' end
union all select 'authenticated and anon have nothing',case when (select f from t) is null or (
  not has_table_privilege('authenticated',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select f from t),'select,insert,update,references')
  and not has_table_privilege('authenticated',(select p from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select p from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select p from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select p from t),'select,insert,update,references')
  and not has_any_column_privilege('authenticated',(select c from t),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select c from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select f from t) is null or not exists(select 1 from pg_class where oid in ((select f from t),(select p from t),(select c from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'service_role: four privileges on index tables only',case when (select f from t) is null or (
  has_table_privilege('service_role',(select f from t),'select') and has_table_privilege('service_role',(select f from t),'insert')
  and has_table_privilege('service_role',(select f from t),'update') and has_table_privilege('service_role',(select f from t),'delete')
  and has_table_privilege('service_role',(select p from t),'select') and has_table_privilege('service_role',(select p from t),'insert')
  and has_table_privilege('service_role',(select p from t),'update') and has_table_privilege('service_role',(select p from t),'delete')
  and not has_table_privilege('service_role',(select f from t),'truncate,references,trigger')
  and not has_table_privilege('service_role',(select p from t),'truncate,references,trigger')) then '예' else '아니오' end
union all select 'connections: new columns update only, workspace_id still fixed',case when (select f from t) is null or (
  has_column_privilege('service_role',(select c from t),'delta_link','update') and has_column_privilege('service_role',(select c from t),'index_lock_until','update')
  and not has_column_privilege('service_role',(select c from t),'delta_link','insert')
  and not has_column_privilege('service_role',(select c from t),'workspace_id','update')
  and not has_table_privilege('service_role',(select c from t),'insert,update')) then '예' else '아니오' end;
