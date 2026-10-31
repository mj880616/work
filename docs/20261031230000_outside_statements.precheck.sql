-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / new tables absent 예 / search function absent 예 / owner check function 예 / workspaces table 예.
-- recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261031230000') then '예' else '아니오' end as value
union all select 'new tables absent',case when to_regclass('public.app_outside_sources') is null and to_regclass('public.app_outside_posts') is null
  and to_regclass('public.app_outside_sentences') is null and to_regclass('public.app_outside_seen') is null then '예' else '아니오' end
union all select 'search function absent',case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='app_outside_search') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
