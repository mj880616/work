-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125113000') then '예' else '아니오' end as value
union all select 'brief migration recorded',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261125010000' and name='news_highlights_brief') then '예' else '아니오' end
union all select 'highlights table has no mark columns',case when to_regclass('public.app_news_highlights') is not null
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_highlights') and attname in ('mark_kind','mark_color') and not attisdropped) then '예' else '아니오' end
union all select 'type check present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_news_highlights') and conname='app_news_highlights_type_check' and contype='c') then '예' else '아니오' end
union all select 'highlights policy is the one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_highlights'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_news_highlights') and polname='news_highlights_owner_all' and polcmd='*' and polroles=array[to_regrole('authenticated')::oid]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
