-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·칸·검사가 함께 없음).
with t as (select to_regclass('public.app_org_status_rows') as p),
history as (select count(*) filter(where name='org_status_rows_end_day') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261104201500'),
col as (select count(*) as n from pg_attribute,t where attrelid=t.p and attname='end_day' and not attisdropped),
chk as (select count(*) as n from pg_constraint,t where conrelid=t.p and conname='app_org_status_rows_end_check')
select 'history column and check agree' as item,case when
  (history.n=0 and col.n=0 and chk.n=0)
  or (history.n=1 and history.named=1 and col.n=1 and chk.n=1) then '예' else '아니오' end as ok
  from history,col,chk
union all select 'owner policy RLS and anon access unchanged',case when
  (select relrowsecurity from pg_class where oid=(select p from t))
  and (select count(*) from pg_policy where polrelid=(select p from t))=1
  and not has_any_column_privilege('anon',(select p from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select p from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select p from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated end_day column grants match history',case when
  (select n from history)=0 or (has_column_privilege('authenticated',(select p from t),'end_day','insert') and has_column_privilege('authenticated',(select p from t),'end_day','update')) then '예' else '아니오' end;
