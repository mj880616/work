-- SELECT only. Works after apply (all 예) and after rollback (all 예 by the received-date shape). The shape that must hold follows the migration history row.
with history as (
  select count(*) filter(where name='outside_search_undated') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261102150000'
)
select 'history agrees with the function shape' as item,case when
  (select n=1 and named=1 from history) and (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)') and prosrc like '%p.published_at is not null and (p.published_at at time zone%' and prosrc like '%order by p.published_at desc nulls last%' and prosrc not like '%coalesce(p.published_at, p.fetched_at)%')=1
  or (select n=0 from history) and (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)') and prosrc like '%coalesce(p.published_at, p.fetched_at) at time zone%')=1
  then '예' else '아니오' end as ok
union all select 'search function invoker with fixed search_path',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)') and not prosecdef and proconfig=array['search_path=""'])=1 then '예' else '아니오' end
union all select 'one search function overload',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_outside_search')=1 then '예' else '아니오' end
union all select 'search runs for authenticated only',case when has_function_privilege('authenticated','public.app_outside_search(text, text[], text[], date, date, integer, integer)','execute') and not has_function_privilege('anon','public.app_outside_search(text, text[], text[], date, date, integer, integer)','execute') and (select proacl::text !~ '(^|[{,])(anon|service_role)?=' from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)')) then '예' else '아니오' end
union all select 'RLS enabled on posts and sentences',case when (select count(*) from pg_class where oid in(to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences')) and relrowsecurity)=2 then '예' else '아니오' end;
