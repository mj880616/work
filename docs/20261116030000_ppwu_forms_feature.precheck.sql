-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·허용 행 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migration 예 / feature helper 예 / feature check with outside without ppwu_forms 예 /
-- ppwu_forms rows 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: ppwu_forms rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261116030000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261113230000' and name='arsenal_outside_features') then '예' else '아니오' end
union all select 'feature helper',case when to_regprocedure('public.app_my_features()') is not null then '예' else '아니오' end
union all select 'feature check with outside without ppwu_forms',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ '''outside''' and pg_get_constraintdef(oid) !~ '''ppwu_forms''')=1 then '예' else '아니오' end
union all select 'ppwu_forms rows',(select count(*) from public.app_operator_features where feature::text='ppwu_forms')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
