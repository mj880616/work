-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·허용 행 개수만 읽는다.
-- 적용 전 기대: 아래 예 4개, brief_plus rows 0. recent migrations는 기록만.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: feature check with mcp_write without brief_plus = 예
-- expect: single calls workspace = 예
-- expect: brief_plus rows = 0
-- expect: recent migrations = 기록
select 'prerequisite recorded' as item,case when exists(select 1 from supabase_migrations.schema_migrations where version='20261128100000' and name='mcp_claude_write') then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261128130000') then '예' else '아니오' end
union all select 'feature check with mcp_write without brief_plus',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ '''mcp_write''' and pg_get_constraintdef(oid) !~ '''brief_plus''')=1 then '예' else '아니오' end
union all select 'single calls workspace',case when (select count(*) from public.app_operator_features where feature='calls')=1 then '예' else '아니오' end
union all select 'brief_plus rows',(select count(*) from public.app_operator_features where feature::text='brief_plus')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
