-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표 없음, 함수는 이전 판).
with f as (
  select to_regprocedure('public.app_search_records(text,text[],integer,integer,text)') as fn, to_regclass('public.app_ask_answers') as t
), history as (
  select count(*) filter(where name='ask_web2') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261029061500'
)
select 'function, table and history agree' as item,case when f.fn is not null and (
  (history.n=0 and f.t is null and exists(select 1 from pg_proc where oid=f.fn and md5(prosrc)='a7e51ce33f40e8e022a6a88a5bc7bd89'))
  or (history.n=1 and history.named=1 and f.t is not null and exists(select 1 from pg_proc where oid=f.fn and prosrc like '%''telegram'' = any (v_kinds)%'))) then '예' else '아니오' end as ok
  from f,history
union all select 'only one app_search_records',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'security invoker, stable, search_path empty',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and not prosecdef and proconfig=array['search_path=""'] and provolatile='s') then '예' else '아니오' end
union all select 'search: authenticated only',case when has_function_privilege('authenticated',(select fn from f),'execute')
  and not has_function_privilege('anon',(select fn from f),'execute') and not has_function_privilege('service_role',(select fn from f),'execute')
  and not exists(select 1 from pg_proc where oid=(select fn from f) and (proacl is null or proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'search never reads diary, personal call box or raw text',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and prosrc like '%n.kind in (''basket'', ''note'', ''work'')%' and prosrc not like '%''diary''%' and prosrc not like '%app_call_personal%'
  and prosrc not like '%app_tg_personal%' and prosrc not like '%f.raw_text%') then '예' else '아니오' end
union all select 'answers: RLS on, 1 owner policy for authenticated only, no trigger',case when (select t from f) is null or (
  (select relrowsecurity from pg_class where oid=(select t from f))
  and (select count(*) from pg_policy where polrelid=(select t from f))=1
  and not exists(select 1 from pg_policy where polrelid=(select t from f) and not (polroles=array[to_regrole('authenticated')::oid]))
  and not exists(select 1 from pg_trigger where tgrelid=(select t from f) and not tgisinternal)) then '예' else '아니오' end
union all select 'answers: anon PUBLIC service_role have nothing',case when (select t from f) is null or (
  not has_table_privilege('anon',(select t from f),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select t from f),'select,insert,update,references')
  and not has_table_privilege('service_role',(select t from f),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select t from f),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select t from f) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'answers: authenticated read delete, insert 5 columns, no update',case when (select t from f) is null or (
  has_table_privilege('authenticated',(select t from f),'select') and has_table_privilege('authenticated',(select t from f),'delete')
  and has_column_privilege('authenticated',(select t from f),'question','insert') and has_column_privilege('authenticated',(select t from f),'sources','insert')
  and not has_column_privilege('authenticated',(select t from f),'created_at','insert') and not has_column_privilege('authenticated',(select t from f),'id','insert')
  and not has_any_column_privilege('authenticated',(select t from f),'update')
  and not has_table_privilege('authenticated',(select t from f),'truncate,references,trigger')) then '예' else '아니오' end;
