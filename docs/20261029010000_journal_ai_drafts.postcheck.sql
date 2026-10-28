-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표가 함께 없음).
with t as (select to_regclass('public.app_journal_drafts') as f),
history as (select count(*) filter(where name='journal_ai_drafts') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261029010000')
select 'table and history agree' as item,case when
  (history.n=0 and t.f is null) or (history.n=1 and history.named=1 and t.f is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on, 1 owner policy for authenticated only, no trigger',case when (select f from t) is null or (
  (select relrowsecurity from pg_class where oid=(select f from t))
  and (select count(*) from pg_policy where polrelid=(select f from t))=1
  and not exists(select 1 from pg_policy where polrelid=(select f from t) and not (polroles=array[to_regrole('authenticated')::oid]))
  and not exists(select 1 from pg_trigger where tgrelid=(select f from t) and not tgisinternal)) then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select f from t) is null or (
  not has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select f from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, insert 3 columns, no update',case when (select f from t) is null or (
  has_table_privilege('authenticated',(select f from t),'select') and has_table_privilege('authenticated',(select f from t),'delete')
  and has_column_privilege('authenticated',(select f from t),'draft_text','insert') and has_column_privilege('authenticated',(select f from t),'journal_day','insert')
  and not has_column_privilege('authenticated',(select f from t),'created_at','insert')
  and not has_any_column_privilege('authenticated',(select f from t),'update')
  and not has_table_privilege('authenticated',(select f from t),'truncate,references,trigger')) then '예' else '아니오' end;
