-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / new tables absent 예 / new function absent 예 / owner check function 예 / workspaces table 예 / outside posts table 예 / news items table 예.
-- recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102140000') then '예' else '아니오' end as value
union all select 'new tables absent',case when to_regclass('public.app_now_details') is null and to_regclass('public.app_outside_marks') is null
  and to_regclass('public.app_now_signals') is null and to_regclass('public.app_now_interests') is null then '예' else '아니오' end
union all select 'new function absent',case when to_regprocedure('private.app_now_item_scope_guard()') is null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'outside posts table',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'news items table',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_items') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
