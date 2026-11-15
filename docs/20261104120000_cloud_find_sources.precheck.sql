-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog·migration 기록·개수만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / prerequisite migration 예 / new function and indexes absent 예 / find is invoker 예 / helpers 예 /
-- documents columns 예 / cloud items policy one each 예. 색인 줄 수·자료실 file_id 색인 목록·최근 기록은 기록만.
-- expect: cloud items rows = 기록
-- expect: documents file indexes = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104120000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261102160000' and name='cloud_files_index') then '예' else '아니오' end
union all select 'new function and indexes absent',case when to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is null
  and to_regclass('public.app_cloud_items_recent_src_idx') is null and to_regclass('public.app_cloud_items_big_src_idx') is null
  and to_regclass('public.app_documents_workspace_file_idx') is null then '예' else '아니오' end
union all select 'find is invoker',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_cloud_find(text,text,integer)') and not prosecdef)=1
  and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('app_cloud_find','app_cloud_find_in'))=1 then '예' else '아니오' end
union all select 'helpers',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null
  and to_regclass('public.app_workspace_members') is not null then '예' else '아니오' end
union all select 'documents columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_documents') and not attisdropped
  and attname in ('workspace_id','file_id','extraction_status','extracted_text'))=4 then '예' else '아니오' end
union all select 'cloud items policy one each',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_items'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_cloud_stars'))=1 then '예' else '아니오' end
union all select 'cloud items rows',(select count(*) from public.app_cloud_items)::text
union all select 'documents file indexes',coalesce((select count(*) from pg_indexes where schemaname='public' and tablename='app_documents' and indexdef ~ 'file_id')::text,'0')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
