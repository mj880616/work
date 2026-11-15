-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수가 함께 원래대로).
with t as (select to_regclass('public.app_outside_sources') as s,to_regclass('public.app_outside_posts') as p,
  to_regclass('public.app_outside_sentences') as x,to_regclass('public.app_outside_seen') as v,
  to_regprocedure('public.app_outside_search(text,text[],text[],date,date,integer,integer)') as f),
history as (select count(*) filter(where name='outside_statements') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261031230000')
select 'tables, function and history agree' as item,case when
  (history.n=0 and t.s is null and t.p is null and t.x is null and t.v is null and t.f is null)
  or (history.n=1 and history.named=1 and t.s is not null and t.p is not null and t.x is not null and t.v is not null and t.f is not null)
  then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on and one authenticated owner policy per table',case when (select s from t) is null or (
  (select count(*) from pg_class where oid in ((select s from t),(select p from t),(select x from t),(select v from t)) and relrowsecurity)=4
  and (select count(*) from pg_policy where polrelid in ((select s from t),(select p from t),(select x from t),(select v from t))
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=4
  and (select count(*) from pg_policy where polrelid in ((select s from t),(select p from t),(select x from t),(select v from t)))=4) then '예' else '아니오' end
union all select 'anon has nothing and no PUBLIC grant',case when (select s from t) is null or (not exists(
  select 1 from unnest(array[(select s from t),(select p from t),(select x from t),(select v from t)]) r(r)
  where has_table_privilege('anon',r.r,'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon',r.r,'select,insert,update,references'))
  and not exists(select 1 from pg_class where oid in ((select s from t),(select p from t),(select x from t),(select v from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated reads posts and sentences only',case when (select s from t) is null or (
  has_table_privilege('authenticated',(select p from t),'select') and has_table_privilege('authenticated',(select x from t),'select')
  and not has_table_privilege('authenticated',(select p from t),'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated',(select x from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select p from t),'insert,update')
  and not has_any_column_privilege('authenticated',(select x from t),'insert,update')) then '예' else '아니오' end
union all select 'authenticated changes only switch and seen time',case when (select s from t) is null or (
  has_column_privilege('authenticated',(select s from t),'enabled','update')
  and not has_column_privilege('authenticated',(select s from t),'last_ok_at','insert,update')
  and not has_column_privilege('authenticated',(select s from t),'last_error','insert,update')
  and not has_column_privilege('authenticated',(select s from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select v from t),'seen_at','update')
  and not has_column_privilege('authenticated',(select v from t),'workspace_id','update')
  and not has_table_privilege('authenticated',(select v from t),'delete')) then '예' else '아니오' end
union all select 'service_role: four privileges on new tables',case when (select s from t) is null or not exists(
  select 1 from unnest(array[(select s from t),(select p from t),(select x from t),(select v from t)]) r(r)
  where not has_table_privilege('service_role',r.r,'select,insert,update,delete') or has_table_privilege('service_role',r.r,'truncate,references,trigger')) then '예' else '아니오' end
union all select 'search function invoker and authenticated only',case when (select f from t) is null or (
  not (select prosecdef from pg_proc where oid=(select f from t))
  and has_function_privilege('authenticated',(select f from t),'execute')
  and not has_function_privilege('anon',(select f from t),'execute')
  and not exists(select 1 from pg_proc where oid=(select f from t) and proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'foreign posts cannot get sentences',case when (select x from t) is null or exists(
  select 1 from pg_constraint where conrelid=(select x from t) and conname='app_outside_sentences_lang_check' and contype='c') then '예' else '아니오' end;
