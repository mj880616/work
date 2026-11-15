-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 없음).
with t as (select to_regclass('public.app_org_key_people') as p,to_regclass('public.app_org_key_people_briefs') as b),
history as (select count(*) filter(where name='org_key_people') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261029014700')
select 'tables function and history agree' as item,case when
  (history.n=0 and t.p is null and t.b is null and to_regprocedure('private.app_org_key_people_guard()') is null)
  or (history.n=1 and history.named=1 and t.p is not null and t.b is not null
      and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_org_key_people_guard()') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%ORG_KEY_PEOPLE_SCOPE:%' and prosrc like '%ORG_KEY_PEOPLE_MATCH:%')) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner policy each for authenticated only, 1 trigger each',case when (select p from t) is null or (
  (select relrowsecurity from pg_class where oid=(select p from t)) and (select relrowsecurity from pg_class where oid=(select b from t))
  and (select count(*) from pg_policy where polrelid=(select p from t))=1 and (select count(*) from pg_policy where polrelid=(select b from t))=1
  and not exists(select 1 from pg_policy where polrelid in ((select p from t),(select b from t)) and not (polroles=array[to_regrole('authenticated')::oid]))
  and (select count(*) from pg_trigger where tgrelid=(select p from t) and not tgisinternal)=1
  and (select count(*) from pg_trigger where tgrelid=(select b from t) and not tgisinternal)=1) then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select p from t) is null or (
  not has_table_privilege('anon',(select p from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select p from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select p from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select p from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select b from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select b from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select p from t),(select b from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, insert and update named columns only',case when (select p from t) is null or (
  has_table_privilege('authenticated',(select p from t),'select') and has_table_privilege('authenticated',(select p from t),'delete')
  and has_column_privilege('authenticated',(select p from t),'name','insert') and not has_column_privilege('authenticated',(select p from t),'id','insert')
  and has_column_privilege('authenticated',(select p from t),'match_names','update')
  and not has_column_privilege('authenticated',(select p from t),'workspace_id','update')
  and not has_column_privilege('authenticated',(select p from t),'organization_id','update')
  and not has_table_privilege('authenticated',(select p from t),'truncate,references,trigger')
  and has_table_privilege('authenticated',(select b from t),'select') and has_column_privilege('authenticated',(select b from t),'brief','update')
  and not has_column_privilege('authenticated',(select b from t),'workspace_id','update')
  and not has_column_privilege('authenticated',(select b from t),'organization_id','update')
  and not has_table_privilege('authenticated',(select b from t),'truncate,references,trigger')) then '예' else '아니오' end;
