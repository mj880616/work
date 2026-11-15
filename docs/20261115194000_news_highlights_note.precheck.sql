-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·밑줄 종류별 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migration 예 / type check without note 예 / only known types 예 / note rows 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: note rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115194000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261108070000' and name='news_highlights') then '예' else '아니오' end
union all select 'type check without note',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_highlights')
  and conname='app_news_highlights_type_check' and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) !~ '''note''')=1 then '예' else '아니오' end
union all select 'only known types',case when not exists(select 1 from public.app_news_highlights where source_type not in ('news','outside','telegram')) then '예' else '아니오' end
union all select 'note rows',(select count(*) from public.app_news_highlights where source_type='note')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
