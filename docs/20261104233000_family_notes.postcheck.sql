-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다(새 표의 행 값은 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·허용 행·검사가 함께 원래대로).
with o as (select to_regclass('public.app_operator_features') as r),
t as (select to_regclass('public.app_family_notes') as r),
history as (select count(*) filter(where name='family_notes') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261104233000'),
feat as (select count(*) filter(where feature='family') as k,
  count(*) filter(where feature='family' and workspace_id in (select workspace_id from public.app_operator_features where feature='calls')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''family''') as with_f,count(*) filter(where pg_get_constraintdef(oid) ~ '''dev_inbox''') as with_d,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check')
select 'table, feature row, check and history agree' as item,case when
  (history.n=0 and (select r from t) is null and to_regprocedure('private.app_family_feature_guard()') is null and feat.k=0 and chk.n=1 and chk.with_f=0 and chk.with_d=1)
  or (history.n=1 and history.named=1 and (select r from t) is not null and to_regprocedure('private.app_family_feature_guard()') is not null
      and feat.k=1 and feat.same=1 and chk.n=1 and chk.with_f=1 and chk.with_d=1)
  then '예' else '아니오' end as ok
  from history,feat,chk
union all select 'new table: RLS on, three authenticated policies (one restrictive)',case when (select r from t) is null or (
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=3
  and (select count(*) from pg_policy where polrelid=(select r from t) and polroles=array['authenticated'::regrole]::oid[])=3
  and (select count(*) from pg_policy where polrelid=(select r from t) and not polpermissive)=1) then '예' else '아니오' end
union all select 'new table: no anon or PUBLIC privileges',case when (select r from t) is null or (
  not exists(select 1 from pg_class where oid=(select r from t) and coalesce(relacl::text,'') ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select r from t) and attacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete')) then '예' else '아니오' end
union all select 'new table: authenticated read + decision columns only, service_role insert + read only',case when (select r from t) is null or (
  not has_table_privilege('authenticated',(select r from t),'insert,delete')
  and not has_column_privilege('authenticated',(select r from t),'body','update')
  and has_column_privilege('authenticated',(select r from t),'status','update')
  and not has_any_column_privilege('service_role',(select r from t),'update')
  and not has_table_privilege('service_role',(select r from t),'delete')
  and not has_column_privilege('service_role',(select r from t),'status','insert')
  and not has_column_privilege('service_role',(select r from t),'drive_url','select')) then '예' else '아니오' end
union all select 'guard function: definer, empty search_path, nobody executes',case when to_regprocedure('private.app_family_feature_guard()') is null or (
  (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=to_regprocedure('private.app_family_feature_guard()'))
  and not has_function_privilege('authenticated',to_regprocedure('private.app_family_feature_guard()'),'execute')
  and not has_function_privilege('anon',to_regprocedure('private.app_family_feature_guard()'),'execute')
  and not has_function_privilege('service_role',to_regprocedure('private.app_family_feature_guard()'),'execute')) then '예' else '아니오' end
union all select 'no other DB function names the new table',case when not exists(select 1 from pg_proc
  where prosrc ~ 'app_family_notes' and oid<>coalesce(to_regprocedure('private.app_family_feature_guard()'),0)) then '예' else '아니오' end
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end;
