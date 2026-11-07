-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog·migration 기록만 읽는다(앱 표 행 없음).
-- 적용 전 기대: new migration absent 예 / operator features recorded 예 / workspaces table 예 / new table absent 예 / new function absent 예.
-- expect: new migration absent = 예
-- expect: operator features recorded = 예
-- expect: workspaces table = 예
-- expect: new table absent = 예
-- expect: new function absent = 예
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261108040000') then '예' else '아니오' end as value
union all select 'operator features recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261029090000' and name='operator_features')=1 then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_feed_pulls') is null then '예' else '아니오' end
union all select 'new function absent',case when not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname='app_feed_pull_take') then '예' else '아니오' end
union all select 'recent migrations',coalesce((select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r),'없음');
