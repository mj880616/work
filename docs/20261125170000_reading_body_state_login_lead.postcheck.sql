-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록이 없으면 두 검사가 옛 모양).
with t as (select to_regclass('public.app_reading_items') as r),
history as (select count(*) filter(where name='reading_body_state_login_lead') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125170000'),
st as (select count(*) as n,count(*) filter(where pg_get_constraintdef(oid) ~ '''lead''' and pg_get_constraintdef(oid) ~ '''login''') as new_shape
  from pg_constraint where conrelid=(select r from t) and conname='app_reading_items_body_state_check' and contype='c' and convalidated and pg_get_constraintdef(oid) ~ 'paywall' and pg_get_constraintdef(oid) ~ 'bot_check'),
bd as (select count(*) as n,count(*) filter(where pg_get_constraintdef(oid) ~ '''lead''') as new_shape
  from pg_constraint where conrelid=(select r from t) and conname='app_reading_items_body_check' and contype='c' and convalidated and pg_get_constraintdef(oid) ~ '200000')
select 'checks and history agree' as item,case when st.n=1 and bd.n=1 and ((history.n=0 and st.new_shape=0 and bd.new_shape=0) or (history.n=1 and history.named=1 and st.new_shape=1 and bd.new_shape=1)) then '예' else '아니오' end as ok
  from history,st,bd
union all select 'RLS on, one owner policy',case when (select relrowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=1
  and (select count(*) from pg_policy where polrelid=(select r from t) and polname='reading_items_owner_all' and polroles=array[to_regrole('authenticated')::oid])=1 then '예' else '아니오' end
union all select 'anon has nothing',case when not exists(select 1 from t where
  has_table_privilege('anon',t.r,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',t.r,'select,insert,update,references')) then '예' else '아니오' end;
