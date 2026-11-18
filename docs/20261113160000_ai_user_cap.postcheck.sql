-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·허용 행·검사·새 표·함수가 함께 원래대로).
with o as (select to_regclass('public.app_operator_features') as r, to_regclass('public.app_workspace_ai_caps') as caps),
history as (select count(*) filter(where name='ai_user_cap') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261113160000'),
feat as (select count(*) filter(where feature='ai_no_cap') as k,
  count(*) filter(where feature='ai_no_cap' and workspace_id in (select workspace_id from public.app_operator_features where feature='calls')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ 'ai_no_cap') as with_a,count(*) filter(where pg_get_constraintdef(oid) ~ '''family''') as with_f,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check'),
fn as (select count(*) as n,
  count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""'] and coalesce(p.proacl::text,'') !~ '(^|[{,])(anon)?=') as safe
  from pg_proc p where p.oid in (to_regprocedure('private.app_ai_month_usage(uuid)'),to_regprocedure('public.app_my_ai_month(uuid)'),to_regprocedure('public.app_workspace_ai_month(uuid)')))
select 'feature row, check, cap table, functions and history agree' as item,case when
  (history.n=0 and feat.k=0 and chk.n=1 and chk.with_a=0 and chk.with_f=1 and (select caps from o) is null and fn.n=0)
  or (history.n=1 and history.named=1 and feat.k=1 and feat.same=1 and chk.n=1 and chk.with_a=1 and chk.with_f=1 and (select caps from o) is not null and fn.n=3 and fn.safe=3)
  then '예' else '아니오' end as ok
  from history,feat,chk,fn
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'cap table: absent, or closed to API roles',case when (select caps from o) is null or (
  (select relrowsecurity from pg_class where oid=(select caps from o))
  and not exists(select 1 from pg_policy where polrelid=(select caps from o))
  and not has_table_privilege('authenticated',(select caps from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select caps from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select caps from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select caps from o) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'functions: absent, or one API role each',case when
  to_regprocedure('public.app_my_ai_month(uuid)') is null or (
  has_function_privilege('authenticated','public.app_my_ai_month(uuid)','execute')
  and not has_function_privilege('anon','public.app_my_ai_month(uuid)','execute')
  and not has_function_privilege('service_role','public.app_my_ai_month(uuid)','execute')
  and has_function_privilege('service_role','public.app_workspace_ai_month(uuid)','execute')
  and not has_function_privilege('anon','public.app_workspace_ai_month(uuid)','execute')
  and not has_function_privilege('authenticated','public.app_workspace_ai_month(uuid)','execute')
  and not has_function_privilege('anon','private.app_ai_month_usage(uuid)','execute')
  and not has_function_privilege('authenticated','private.app_ai_month_usage(uuid)','execute')
  and not has_function_privilege('service_role','private.app_ai_month_usage(uuid)','execute')) then '예' else '아니오' end;
