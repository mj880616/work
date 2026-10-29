-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_photo_tags') as g,to_regclass('public.app_photo_tag_items') as i),
history as (select count(*) filter(where name='photo_tags') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261029150000')
select 'tables and history agree' as item,case when
  (history.n=0 and t.g is null and t.i is null) or (history.n=1 and history.named=1 and t.g is not null and t.i is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner policy each for authenticated only',case when (select g from t) is null or (
  (select count(*) from pg_class where oid in ((select g from t),(select i from t)) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid=(select g from t))=1
  and (select count(*) from pg_policy where polrelid=(select i from t))=1
  and not exists(select 1 from pg_policy where polrelid in ((select g from t),(select i from t)) and not (polroles=array[to_regrole('authenticated')::oid]))) then '예' else '아니오' end
union all select 'anon, PUBLIC and service_role have nothing',case when (select g from t) is null or (
  not has_table_privilege('anon',(select g from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select i from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select g from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select i from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select g from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select i from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select g from t),(select i from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: tags read/insert/update name and cover/delete, items read/insert/delete',case when (select g from t) is null or (
  has_table_privilege('authenticated',(select g from t),'select,delete')
  and has_column_privilege('authenticated',(select g from t),'name','update')
  and not has_column_privilege('authenticated',(select g from t),'workspace_id','update')
  and has_table_privilege('authenticated',(select i from t),'select,delete')
  and has_column_privilege('authenticated',(select i from t),'item_key','insert')
  and not has_any_column_privilege('authenticated',(select i from t),'update')) then '예' else '아니오' end
union all select 'tag name unique per workspace ignoring case',case when (select g from t) is null or exists(
  select 1 from pg_index where indrelid=(select g from t) and indisunique and indexprs is not null) then '예' else '아니오' end;
