-- SELECT only. pg_catalog와 migration 기록만 읽는다(새 표·상세 표의 행 값·행 수를 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·칸이 함께 원래대로).
-- expect: table, topic column and history agree = 예
-- expect: RLS on, one authenticated owner select policy = 예
-- expect: no anon or PUBLIC privileges = 예
-- expect: authenticated read only = 예
-- expect: service_role select + column insert/update, no delete = 예
-- expect: one row per workspace, day and feature, cascade, checks = 예
-- expect: topic: nullable text, four values, table grants unchanged = 예
-- expect: no DB function or view names the new table or column = 예
with t as (select to_regclass('public.app_feed_ai_days') as r,to_regclass('public.app_now_details') as d,
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_now_details') and attname='topic' and not attisdropped) as has_topic),
history as (select count(*) filter(where name='feed_ai_days') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261106100000')
select 'table, topic column and history agree' as item,case when
  (history.n=0 and t.r is null and not t.has_topic)
  or (history.n=1 and history.named=1 and t.r is not null and t.has_topic)
  then '예' else '아니오' end as value
  from t,history
union all select 'RLS on, one authenticated owner select policy',case when (select r from t) is null or (
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=1
  and (select count(*) from pg_policy where polrelid=(select r from t) and polcmd='r' and polpermissive
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=1) then '예' else '아니오' end
union all select 'no anon or PUBLIC privileges',case when (select r from t) is null or (
  not exists(select 1 from pg_class where oid=(select r from t) and coalesce(relacl::text,'') ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select r from t) and attacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'authenticated read only',case when (select r from t) is null or (
  has_table_privilege('authenticated',(select r from t),'select')
  and not has_table_privilege('authenticated',(select r from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select r from t),'insert,update,references')) then '예' else '아니오' end
union all select 'service_role select + column insert/update, no delete',case when (select r from t) is null or (
  has_table_privilege('service_role',(select r from t),'select')
  and not has_table_privilege('service_role',(select r from t),'insert,update,delete,truncate,references,trigger')
  and has_column_privilege('service_role',(select r from t),'requests','insert')
  and has_column_privilege('service_role',(select r from t),'cost_krw','update')
  and not has_column_privilege('service_role',(select r from t),'updated_at','insert')) then '예' else '아니오' end
union all select 'one row per workspace, day and feature, cascade, checks',case when (select r from t) is null or (
  (select count(*) from pg_constraint where conrelid=(select r from t) and contype='p'
     and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, day, feature)')=1
  and (select count(*) from pg_constraint where conrelid=(select r from t) and contype='f' and confdeltype='c'
     and confrelid=to_regclass('public.app_workspaces'))=1
  and (select count(*) from pg_constraint where conrelid=(select r from t) and contype='c'
     and conname in ('app_feed_ai_days_feature_check','app_feed_ai_days_counts_check'))=2
  and (select count(*) from pg_trigger where tgrelid=(select r from t) and not tgisinternal)=0) then '예' else '아니오' end
union all select 'topic: nullable text, four values, table grants unchanged',case when not (select has_topic from t) or (
  (select count(*) from pg_attribute where attrelid=(select d from t) and attname='topic' and atttypid='text'::regtype
     and not attnotnull and not atthasdef and not attisdropped and attacl is null)=1
  and (select count(*) from pg_constraint where conrelid=(select d from t) and conname='app_now_details_topic_check' and contype='c'
     and pg_get_constraintdef(oid) ~ 'labor' and pg_get_constraintdef(oid) ~ 'politics'
     and pg_get_constraintdef(oid) ~ 'economy' and pg_get_constraintdef(oid) ~ 'society')=1
  and has_column_privilege('authenticated',(select d from t),'topic','select')
  and not has_any_column_privilege('authenticated',(select d from t),'insert,update')
  and not has_table_privilege('anon',(select d from t),'select,insert,update,delete')
  and has_column_privilege('service_role',(select d from t),'topic','insert')
  and has_column_privilege('service_role',(select d from t),'topic','update')) then '예' else '아니오' end
union all select 'no DB function or view names the new table or column',case when
  not exists(select 1 from pg_proc where prosrc ~ 'app_feed_ai_days')
  and not exists(select 1 from pg_views where definition ~ 'app_feed_ai_days') then '예' else '아니오' end;
