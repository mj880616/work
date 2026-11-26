-- SELECT only. pg_catalog·migration 기록·허용 행 개수만 읽는다(작업공간 id 값은 보이지 않음). 적용 뒤 모두 예, 되돌린 뒤·dry-run 뒤에도 모두 예.
-- 적용 뒤: 기록 1행 + 검사에 photo_content + 허용 행 1개(calls 작업공간). 되돌린 뒤: 기록 없음 + 검사에 없음 + 허용 행 0개.
with o as (select to_regclass('public.app_operator_features') as r),
history as (select count(*) filter(where name='photo_content_feature') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261126190000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''photo_content''') as with_k,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''blog''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check'),
allow as (select count(*) as n,count(*) filter(where exists(select 1 from public.app_operator_features c where c.workspace_id=p.workspace_id and c.feature='calls')) as on_calls
  from public.app_operator_features p where p.feature::text='photo_content')
select 'feature check, allow row and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_k=0 and chk.with_prev=1 and allow.n=0)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_k=1 and chk.with_prev=1 and allow.n=1 and allow.on_calls=1)
  then '예' else '아니오' end as ok
  from history,chk,allow
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end;
