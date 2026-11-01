-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표 넷·함수 셋이 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_news_items','public.app_news_folders','public.app_news_keywords','public.app_news_days']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_news_folder_tree_guard()','private.app_news_folder_lift()','public.app_news_prune(timestamptz,integer)']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261101230000'
order by 1,2;
