-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / operator features migration 예 / new tables absent 예 / feature check without gdrive_photos 예 /
-- calls workspace is the Drive workspace 예 / gdrive_photos rows 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: gdrive_photos rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261031120000') then '예' else '아니오' end as value
union all select 'operator features migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261029090000' and name='operator_features') then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_gdrive_folders') is null and to_regclass('public.app_gdrive_photos') is null and to_regclass('public.app_gdrive_sync') is null then '예' else '아니오' end
union all select 'feature check without gdrive_photos',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ 'telegram' and pg_get_constraintdef(oid) !~ 'gdrive_photos')=1 then '예' else '아니오' end
union all select 'calls workspace is the Drive workspace',case when (select count(*) from public.app_operator_features where feature='calls')=1
  and (select count(*) from public.app_operator_features f join public.app_workspaces w on w.id=f.workspace_id where f.feature='calls' and w.slug='kptu-work')=1 then '예' else '아니오' end
union all select 'gdrive_photos rows',(select count(*) from public.app_operator_features where feature::text='gdrive_photos')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
