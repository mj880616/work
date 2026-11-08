-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 없음).
with r as (select to_regclass('public.app_business_records') as p),
n as (select to_regclass('public.app_business_now') as p),
history as (select count(*) filter(where name='record_one_biz') as named,count(*) as c from supabase_migrations.schema_migrations where version='20261109110000'),
fns as (select count(*) as c from pg_proc where oid in (to_regprocedure('private.app_business_records_guard()'),to_regprocedure('private.app_business_now_guard()'))
  and not prosecdef and proconfig=array['search_path=""'])
select 'tables functions and history agree' as item,case when
  (history.c=0 and (select p from r) is null and (select p from n) is null and fns.c=0
    and to_regprocedure('private.app_business_records_guard()') is null and to_regprocedure('private.app_business_now_guard()') is null)
  or (history.c=1 and history.named=1 and (select p from r) is not null and (select p from n) is not null and fns.c=2) then '예' else '아니오' end as ok
  from history,fns
union all select 'RLS on, 1 owner policy for authenticated only, 1 trigger each',case when (select p from r) is null or (
  (select relrowsecurity from pg_class where oid=(select p from r)) and (select relrowsecurity from pg_class where oid=(select p from n))
  and (select count(*) from pg_policy where polrelid=(select p from r))=1 and (select count(*) from pg_policy where polrelid=(select p from n))=1
  and not exists(select 1 from pg_policy where polrelid in ((select p from r),(select p from n)) and not (polroles=array[to_regrole('authenticated')::oid]))
  and (select count(*) from pg_trigger where tgrelid=(select p from r) and not tgisinternal)=1
  and (select count(*) from pg_trigger where tgrelid=(select p from n) and not tgisinternal)=1) then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select p from r) is null or (
  not has_table_privilege('anon',(select p from r),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select p from n),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select p from r),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select p from n),'select,insert,update,references')
  and not has_table_privilege('service_role',(select p from r),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select p from n),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select p from r),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select p from n),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select p from r),(select p from n)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, insert and update named columns only',case when (select p from r) is null or (
  has_table_privilege('authenticated',(select p from r),'select') and has_table_privilege('authenticated',(select p from r),'delete')
  and has_column_privilege('authenticated',(select p from r),'body','insert') and not has_column_privilege('authenticated',(select p from r),'id','insert')
  and not has_column_privilege('authenticated',(select p from r),'created_by','insert')
  and has_column_privilege('authenticated',(select p from r),'body','update') and has_column_privilege('authenticated',(select p from r),'day','update')
  and not has_column_privilege('authenticated',(select p from r),'workspace_id','update') and not has_column_privilege('authenticated',(select p from r),'space_id','update')
  and not has_column_privilege('authenticated',(select p from r),'source_kind','update') and not has_column_privilege('authenticated',(select p from r),'source_id','update')
  and has_table_privilege('authenticated',(select p from n),'select') and has_table_privilege('authenticated',(select p from n),'delete')
  and has_column_privilege('authenticated',(select p from n),'body','insert') and has_column_privilege('authenticated',(select p from n),'owner_text','update')
  and not has_column_privilege('authenticated',(select p from n),'workspace_id','update') and not has_column_privilege('authenticated',(select p from n),'space_id','update')
  and not has_column_privilege('authenticated',(select p from n),'week_start','update')
  and not has_table_privilege('authenticated',(select p from r),'truncate,references,trigger')
  and not has_table_privilege('authenticated',(select p from n),'truncate,references,trigger')) then '예' else '아니오' end;
