-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·허용 행 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migrations 예 / feature helpers 예 / feature check with dev_inbox without family 예 /
-- single calls workspace 예 / new table and guard absent 예 / family rows 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: family rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261105100000') then '예' else '아니오' end as value
union all select 'prerequisite migrations',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261029090000' and name='operator_features')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261103100000' and name='dev_inbox_feature') then '예' else '아니오' end
union all select 'feature helpers',case when to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null
  and to_regprocedure('private.app_is_workspace_owner(uuid)') is not null and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'feature check with dev_inbox without family',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ '''dev_inbox''' and pg_get_constraintdef(oid) !~ '''family''')=1 then '예' else '아니오' end
union all select 'single calls workspace',case when (select count(*) from public.app_operator_features where feature='calls')=1 then '예' else '아니오' end
union all select 'new table and guard absent',case when to_regclass('public.app_family_notes') is null
  and to_regprocedure('private.app_family_feature_guard()') is null then '예' else '아니오' end
union all select 'family rows',(select count(*) from public.app_operator_features where feature::text='family')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
