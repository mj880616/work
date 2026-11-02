-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수·허용 행·검사가 함께 원래대로).
with t as (select to_regclass('public.app_cloud_sync') as s,to_regclass('public.app_cloud_items') as i,to_regclass('public.app_cloud_stars') as st,
  to_regclass('public.app_operator_features') as o),
fn as (select to_regprocedure('public.app_cloud_list(text,text)') as l,to_regprocedure('public.app_cloud_find(text,text,integer)') as f,
  to_regprocedure('public.app_cloud_trail(text,text)') as tr),
history as (select count(*) filter(where name='cloud_files_index') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261102160000'),
feat as (select count(*) filter(where feature='files') as k,
  count(*) filter(where feature='files' and workspace_id in (select workspace_id from public.app_operator_features where feature='gdrive_photos')) as same
  from public.app_operator_features),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''files''') as with_f,count(*) as n from pg_constraint
  where conrelid=(select o from t) and conname='app_operator_features_feature_check')
select 'tables, functions, feature row, check and history agree' as item,case when
  (history.n=0 and t.s is null and t.i is null and t.st is null and fn.l is null and fn.f is null and fn.tr is null and feat.k=0 and chk.n=1 and chk.with_f=0)
  or (history.n=1 and history.named=1 and t.s is not null and t.i is not null and t.st is not null and fn.l is not null and fn.f is not null and fn.tr is not null
      and feat.k=1 and feat.same=1 and chk.n=1 and chk.with_f=1)
  then '예' else '아니오' end as ok
  from t,fn,history,feat,chk
union all select 'RLS on for new tables and operator table',case when (select i from t) is null or
  (select count(*) from pg_class where oid in ((select s from t),(select i from t),(select st from t),(select o from t)) and relrowsecurity)=4 then '예' else '아니오' end
union all select 'policies: one owner read each on items and stars, none on sync and operator table',case when (select i from t) is null or (
  not exists(select 1 from pg_policy where polrelid in ((select s from t),(select o from t)))
  and (select count(*) from pg_policy where polrelid=(select i from t))=1 and (select count(*) from pg_policy where polrelid=(select st from t))=1
  and not exists(select 1 from pg_policy where polrelid in ((select i from t),(select st from t))
    and (polcmd<>'r' or not polpermissive or polroles<>array['authenticated'::regrole]::oid[]
         or pg_get_expr(polqual,polrelid) !~ 'app_is_workspace_owner\(workspace_id\)'
         or pg_get_expr(polqual,polrelid) !~ 'app_workspace_has_feature\(workspace_id, ''files''::text\)'))) then '예' else '아니오' end
union all select 'authenticated reads items and stars only, anon nothing',case when (select i from t) is null or (
  has_table_privilege('authenticated',(select i from t),'select') and has_table_privilege('authenticated',(select st from t),'select')
  and not exists(select 1 from unnest(array[(select s from t),(select i from t),(select st from t),(select o from t)]) x(r)
    where has_table_privilege('authenticated',x.r,'insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('authenticated',x.r,'insert,update,references')
       or has_table_privilege('anon',x.r,'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon',x.r,'select,insert,update,references'))
  and not has_table_privilege('authenticated',(select s from t),'select')
  and not has_table_privilege('authenticated',(select o from t),'select')) then '예' else '아니오' end
union all select 'no PUBLIC grant on tables',case when not exists(select 1 from pg_class where oid in ((select s from t),(select i from t),(select st from t),(select o from t))
  and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'service_role: four privileges on new tables only',case when (select i from t) is null or (
  not exists(select 1 from unnest(array[(select s from t),(select i from t),(select st from t)]) x(r)
    where not has_table_privilege('service_role',x.r,'select') or not has_table_privilege('service_role',x.r,'insert')
       or not has_table_privilege('service_role',x.r,'update') or not has_table_privilege('service_role',x.r,'delete')
       or has_table_privilege('service_role',x.r,'truncate,references,trigger'))
  and not has_table_privilege('service_role',(select o from t),'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'read functions: invoker, authenticated only, no anon or PUBLIC',case when (select l from fn) is null or not exists(
  select 1 from pg_proc where oid in ((select l from fn),(select f from fn),(select tr from fn))
    and (prosecdef or has_function_privilege('anon',oid,'execute') or proacl::text ~ '(^|[{,])='
         or not has_function_privilege('authenticated',oid,'execute'))) then '예' else '아니오' end;
