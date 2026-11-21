-- SELECT only. pg_catalog·migration 기록만 읽는다(허용 행 값은 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사가 함께 원래대로).
-- 허용 행(nojo_words)은 커맨드센터가 적용 뒤 SQL로 따로 넣으므로 개수는 여기서 보지 않는다(되돌리기 전에는 그 행을 먼저 지운다 — rollback이 막음).
with o as (select to_regclass('public.app_operator_features') as r),
history as (select count(*) filter(where name='nojo_words_feature') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261121090000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''nojo_words''') as with_k,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''ppwu_forms''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_operator_features_feature_check')
select 'feature check and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_k=0 and chk.with_prev=1)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_k=1 and chk.with_prev=1)
  then '예' else '아니오' end as ok
  from history,chk
union all select 'operator table: RLS on, no policies',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and not exists(select 1 from pg_policy where polrelid=(select r from o)) then '예' else '아니오' end
union all select 'operator table: no API role or PUBLIC privileges',case when
  not has_table_privilege('authenticated',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end;
