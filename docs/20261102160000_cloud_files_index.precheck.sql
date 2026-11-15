-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·허용 행 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migrations 예 / new tables and functions absent 예 / owner and feature helpers 예 /
-- feature check without files 예 / gdrive_photos workspace is the calls workspace 예 / files rows 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: files rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102160000') then '예' else '아니오' end as value
union all select 'prerequisite migrations',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261029090000' and name='operator_features')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261031120000' and name='gdrive_photo_index') then '예' else '아니오' end
union all select 'new tables and functions absent',case when to_regclass('public.app_cloud_sync') is null and to_regclass('public.app_cloud_items') is null
  and to_regclass('public.app_cloud_stars') is null and to_regprocedure('public.app_cloud_list(text,text)') is null
  and to_regprocedure('public.app_cloud_find(text,text,integer)') is null and to_regprocedure('public.app_cloud_trail(text,text)') is null then '예' else '아니오' end
union all select 'owner and feature helpers',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null
  and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null and to_regclass('public.app_documents') is not null then '예' else '아니오' end
union all select 'feature check without files',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ 'gdrive_photos' and pg_get_constraintdef(oid) !~ '''files''')=1 then '예' else '아니오' end
union all select 'gdrive_photos workspace is the calls workspace',case when (select count(*) from public.app_operator_features where feature='gdrive_photos')=1
  and (select count(*) from public.app_operator_features g join public.app_operator_features c on c.workspace_id=g.workspace_id and c.feature='calls'
       where g.feature='gdrive_photos')=1 then '예' else '아니오' end
union all select 'files rows',(select count(*) from public.app_operator_features where feature::text='files')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
