-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / workspaces table 예 / article tables 예 / owner function 예 / new table absent 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261128071000') then '예' else '아니오' end as value
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_workspaces') and attname='id' and atttypid='uuid'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'article tables',case when to_regclass('public.app_news_articles') is not null and to_regclass('public.app_outside_articles') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_articles') and attname='id' and atttypid='uuid'::regtype and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_outside_articles') and attname='id' and atttypid='uuid'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_read_ratings') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
