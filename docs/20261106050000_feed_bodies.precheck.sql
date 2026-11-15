-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(앱 표 행 수·행 값을 읽지 않음).
-- 적용 전 기대: 아래 다섯 항목 모두 예. recent migrations는 기록만.
-- expect: new migration absent = 예
-- expect: prerequisite migrations = 예
-- expect: new table and guard absent = 예
-- expect: owner check function and workspaces table = 예
-- expect: item tables with uuid workspace_id = 예
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261106050000') then '예' else '아니오' end as value
union all select 'prerequisite migrations',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261101233000' and name='news_clipping') then '예' else '아니오' end
union all select 'new table and guard absent',case when to_regclass('public.app_feed_bodies') is null
  and to_regprocedure('private.app_feed_bodies_scope_guard()') is null then '예' else '아니오' end
union all select 'owner check function and workspaces table',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'item tables with uuid workspace_id',case when
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_items') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped)
  then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
