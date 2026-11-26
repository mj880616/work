-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록 없음, 함수는 이전 판).
with f as (
  select to_regprocedure('public.app_search_records(text,text[],integer,integer,text)') as fn
), history as (
  select count(*) filter(where name='search_space_insensitive') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261126180000'
)
select 'function and history agree' as item,case when f.fn is not null and (
  (history.n=0 and exists(select 1 from pg_proc where oid=f.fn and length(prosrc)=15851 and md5(prosrc)='8156d333bb3f42170b71c35415eb7cc1'))
  or (history.n=1 and history.named=1 and exists(select 1 from pg_proc where oid=f.fn and length(prosrc)=16215 and md5(prosrc)='b71987c1b2865f47de66c1f1bc3645ec'))) then '예' else '아니오' end as ok
  from f,history
union all select 'only one app_search_records',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'security invoker, stable, search_path empty',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and not prosecdef and proconfig=array['search_path=""'] and provolatile='s') then '예' else '아니오' end
union all select 'search: authenticated only',case when has_function_privilege('authenticated',(select fn from f),'execute')
  and not has_function_privilege('anon',(select fn from f),'execute') and not has_function_privilege('service_role',(select fn from f),'execute')
  and not exists(select 1 from pg_proc where oid=(select fn from f) and (proacl is null or proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'search default kinds unchanged, never diary or raw text',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and prosrc like '%v_all text[] := array[''update'', ''note'', ''work'', ''document'', ''meeting'', ''project'', ''organization'', ''milestone''];%'
  and prosrc like '%n.kind in (''basket'', ''note'', ''work'')%' and prosrc not like '%''diary''%' and prosrc not like '%app_call_personal%'
  and prosrc not like '%app_tg_personal%' and prosrc not like '%f.raw_text%') then '예' else '아니오' end;
