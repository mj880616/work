-- SELECT only. Works after apply (all 예) and after rollback (history absent and the function back to the earlier version → all 예).
with f as (
  select to_regprocedure('public.app_search_records(text,text[],integer,integer,text)') as fn
), history as (
  select count(*) filter(where name='search_attachment_text') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261023013000'
)
select 'function body and history agree' as item,case when f.fn is not null and ((history.n=0 and not exists(select 1 from pg_proc where oid=f.fn and prosrc like '%extracted_text%'))
  or (history.n=1 and history.named=1 and exists(select 1 from pg_proc where oid=f.fn and prosrc like '%d.extraction_status = ''ready''%'))) then '예' else '아니오' end as ok
  from f,history
union all select 'only one app_search_records',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'security invoker, stable, search_path empty',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and not prosecdef and proconfig=array['search_path=""'] and provolatile='s') then '예' else '아니오' end
union all select 'authenticated can execute',case when has_function_privilege('authenticated',(select fn from f),'execute') then '예' else '아니오' end
union all select 'anon cannot execute',case when not has_function_privilege('anon',(select fn from f),'execute') then '예' else '아니오' end
union all select 'service_role cannot execute',case when not has_function_privilege('service_role',(select fn from f),'execute') then '예' else '아니오' end
union all select 'no PUBLIC execute',case when not exists(select 1 from pg_proc where oid=(select fn from f) and (proacl is null or proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'diary excluded in function body',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and prosrc like '%n.kind in (''basket'', ''note'', ''work'')%' and prosrc not like '%''diary''%') then '예' else '아니오' end
union all select 'no index on documents text',case when not exists(select 1 from pg_indexes where schemaname='public' and tablename='app_documents' and indexdef like '%extracted_text%') then '예' else '아니오' end;
