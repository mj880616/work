-- SELECT only. Works after apply (all 예) and after rollback (function and history absent → all 예 by absence).
with f as (
  select to_regprocedure('public.app_search_records(text,text[],integer,integer,text)') as fn
), history as (
  select count(*) filter(where name='search_records') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261022120000'
)
select 'function and history agree' as item,case when (history.n=0 and f.fn is null) or (history.n=1 and history.named=1 and f.fn is not null) then '예' else '아니오' end as ok
  from f,history
union all select 'only one app_search_records',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)<=1 then '예' else '아니오' end
union all select 'security invoker, search_path empty',case when (select fn from f) is null or exists(select 1 from pg_proc where oid=(select fn from f)
  and not prosecdef and proconfig=array['search_path=""'] and provolatile='s') then '예' else '아니오' end
union all select 'authenticated can execute',case when (select fn from f) is null or has_function_privilege('authenticated',(select fn from f),'execute') then '예' else '아니오' end
union all select 'anon cannot execute',case when (select fn from f) is null or not has_function_privilege('anon',(select fn from f),'execute') then '예' else '아니오' end
union all select 'service_role cannot execute',case when (select fn from f) is null or not has_function_privilege('service_role',(select fn from f),'execute') then '예' else '아니오' end
union all select 'no PUBLIC execute',case when (select fn from f) is null or not exists(select 1 from pg_proc where oid=(select fn from f) and (proacl is null or proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'search tables all RLS enabled',case when (select count(*) from pg_class where relrowsecurity and oid in(to_regclass('public.app_notes'),to_regclass('public.app_record_links'),
  to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_spaces'),to_regclass('public.app_project_progress_updates'),
  to_regclass('public.app_project_milestones'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),
  to_regclass('public.app_suborganization_timeline')))=10 then '예' else '아니오' end
union all select 'diary excluded in function body',case when (select fn from f) is null or exists(select 1 from pg_proc where oid=(select fn from f)
  and prosrc like '%n.kind in (''basket'', ''note'', ''work'')%' and prosrc not like '%''diary''%') then '예' else '아니오' end;
