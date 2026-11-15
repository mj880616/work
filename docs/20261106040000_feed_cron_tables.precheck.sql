-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog·migration 기록만 읽는다(앱 표 행·수집 중 바뀌는 수·해시 없음).
-- 적용 전 기대: new migration absent 예 / private schema 예 / new tables absent 예 / new functions absent 예 / helper names free 예.
-- 확장 세 개(pg_cron·pg_net·supabase_vault)는 P1b 준비용 기록만(설계 부록 A-4). recent migrations는 기록만.
-- expect: new migration absent = 예
-- expect: private schema = 예
-- expect: new tables absent = 예
-- expect: new functions absent = 예
-- expect: helper names free = 예
-- expect: extension pg_cron = 기록
-- expect: extension pg_net = 기록
-- expect: extension supabase_vault = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261106040000') then '예' else '아니오' end as value
union all select 'private schema',case when to_regnamespace('private') is not null then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_cron_keys') is null and to_regclass('public.app_feed_runs') is null
  and to_regclass('public.app_feed_jobs') is null then '예' else '아니오' end
union all select 'new functions absent',case when not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('app_feed_enqueue','app_feed_claim','app_feed_sent','app_feed_settle','app_feed_tidy')) then '예' else '아니오' end
union all select 'helper names free',case when not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('app_feed_enqueue','app_feed_claim','app_feed_sent','app_feed_settle','app_feed_tidy')) then '예' else '아니오' end
union all select 'extension pg_cron',case when exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then '예' else '아니오' end
union all select 'extension pg_net',case when exists(select 1 from pg_catalog.pg_extension where extname='pg_net') then '예' else '아니오' end
union all select 'extension supabase_vault',case when exists(select 1 from pg_catalog.pg_extension where extname='supabase_vault') then '예' else '아니오' end
union all select 'recent migrations',coalesce((select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r),'없음');
