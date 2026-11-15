-- SELECT only. pg_catalog·migration 기록만 읽는다(새 표의 행은 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 원래대로).
-- expect: table and history agree = 예
-- expect: RLS on and one authenticated owner policy = 예
-- expect: anon, service_role and PUBLIC have nothing = 예
-- expect: authenticated reads, adds listed columns, deletes = 예
-- expect: authenticated changes memo only = 예
with t as (select to_regclass('public.app_news_highlights') as h),
history as (select count(*) filter(where name='news_highlights') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261108070000')
select 'table and history agree' as item,case when
  (history.n=0 and t.h is null) or (history.n=1 and history.named=1 and t.h is not null)
  then '예' else '아니오' end as value
  from t,history
union all select 'RLS on and one authenticated owner policy',case when (select h from t) is null or (
  exists(select 1 from pg_catalog.pg_class where oid=(select h from t) and relrowsecurity and not relforcerowsecurity)
  and (select count(*) from pg_catalog.pg_policy where polrelid=(select h from t))=1
  and (select count(*) from pg_catalog.pg_policy where polrelid=(select h from t) and polroles=array['authenticated'::regrole]::oid[]
       and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner' and pg_get_expr(polwithcheck,polrelid) ~ 'app_is_workspace_owner')=1) then '예' else '아니오' end
union all select 'anon, service_role and PUBLIC have nothing',case when (select h from t) is null or (
  not has_table_privilege('anon',(select h from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select h from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select h from t),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_catalog.pg_class where oid=(select h from t) and coalesce(relacl::text,'') ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_catalog.pg_attribute where attrelid=(select h from t) and coalesce(attacl::text,'') ~ '(^|[{,])(anon|service_role)?=')) then '예' else '아니오' end
union all select 'authenticated reads, adds listed columns, deletes',case when (select h from t) is null or (
  has_table_privilege('authenticated',(select h from t),'select') and has_table_privilege('authenticated',(select h from t),'delete')
  and not has_table_privilege('authenticated',(select h from t),'insert,update,truncate,references,trigger')
  and has_column_privilege('authenticated',(select h from t),'quote','insert')
  and has_column_privilege('authenticated',(select h from t),'source_id','insert')
  and not has_column_privilege('authenticated',(select h from t),'id','insert')
  and not has_column_privilege('authenticated',(select h from t),'created_at','insert')) then '예' else '아니오' end
union all select 'authenticated changes memo only',case when (select h from t) is null or (
  has_column_privilege('authenticated',(select h from t),'memo','update')
  and not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=(select h from t) and a.attnum>0 and not a.attisdropped
    and a.attname not in ('memo','updated_at') and has_column_privilege('authenticated',(select h from t),a.attname,'update'))) then '예' else '아니오' end;
