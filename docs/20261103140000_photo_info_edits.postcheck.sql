-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_photo_info_edits') as e),
history as (select count(*) filter(where name='photo_info_edits') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261103140000')
select 'table and history agree' as item,case when
  (history.n=0 and t.e is null) or (history.n=1 and history.named=1 and t.e is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner policy for authenticated only',case when (select e from t) is null or (
  (select relrowsecurity from pg_class where oid=(select e from t))
  and (select count(*) from pg_policy where polrelid=(select e from t))=1
  and (select count(*) from pg_policy where polrelid=(select e from t) and polroles=array[to_regrole('authenticated')::oid]
       and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=1) then '예' else '아니오' end
union all select 'anon, PUBLIC and service_role have nothing',case when (select e from t) is null or (
  not has_table_privilege('anon',(select e from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select e from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select e from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select e from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select e from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read, insert values, update undone_at only, no delete',case when (select e from t) is null or (
  has_table_privilege('authenticated',(select e from t),'select')
  and not has_table_privilege('authenticated',(select e from t),'delete,truncate,references,trigger')
  and has_column_privilege('authenticated',(select e from t),'item_key','insert')
  and not has_column_privilege('authenticated',(select e from t),'undone_at','insert')
  and has_column_privilege('authenticated',(select e from t),'undone_at','update')
  and not has_column_privilege('authenticated',(select e from t),'workspace_id','update')
  and not has_column_privilege('authenticated',(select e from t),'before_taken','update')) then '예' else '아니오' end;
