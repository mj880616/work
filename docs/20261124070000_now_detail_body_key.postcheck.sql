-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·새 칸·새 제약이 함께 없음).
with t as (select x.r from unnest(array[to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details')]) x(r)),
history as (select count(*) filter(where name='now_detail_body_key') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261124070000'),
cols as (select count(*) as n from pg_attribute where attrelid in (select r from t) and attname='body_key' and not attisdropped),
cons as (select count(*) as n from pg_constraint where conrelid in (select r from t) and conname in ('app_news_now_details_body_key_check','app_outside_now_details_body_key_check'))
select 'columns, checks and history agree' as item,case when (history.n=0 and cols.n=0 and cons.n=0) or (history.n=1 and history.named=1 and cols.n=2 and cons.n=2) then '예' else '아니오' end as ok
  from history,cols,cons
union all select 'both tables RLS on, one owner select policy each',case when (select count(*) from pg_class where oid in (select r from t) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid in (select r from t))=2
  and not exists(select 1 from pg_policy where polrelid in (select r from t) and not (polcmd='r' and polroles=array[to_regrole('authenticated')::oid])) then '예' else '아니오' end
union all select 'anon has nothing, screens cannot write',case when not exists(select 1 from t where
  has_table_privilege('anon',t.r,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',t.r,'select,insert,update,references')
  or has_table_privilege('authenticated',t.r,'insert,update,delete,truncate')
  or has_any_column_privilege('authenticated',t.r,'insert,update')) then '예' else '아니오' end;
