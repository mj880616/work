-- SELECT only. Run before apply (SQL Editor, phone path C). System catalogs and the migration history only (no post titles or sentences).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 'search function acl'·'recent migrations'는 사후 확인과 비교용으로 캡처만 한다(기록).
-- expect: search function acl = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102150000') then '예' else '아니오' end as value
union all select 'outside statements step recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')=1 then '예' else '아니오' end
union all select 'one search function overload',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_outside_search')=1 then '예' else '아니오' end
union all select 'search function has the received-date shape',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%coalesce(p.published_at, p.fetched_at) at time zone%')=1 then '예' else '아니오' end
union all select 'search runs for authenticated only',case when has_function_privilege('authenticated','public.app_outside_search(text, text[], text[], date, date, integer, integer)','execute') and not has_function_privilege('anon','public.app_outside_search(text, text[], text[], date, date, integer, integer)','execute') then '예' else '아니오' end
union all select 'search function acl',(select coalesce(proacl::text,'none') from pg_proc where oid=to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)'))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
