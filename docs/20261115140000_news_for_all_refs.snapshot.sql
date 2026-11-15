-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표·함수가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_news_article_bodies' as name,coalesce(to_regclass('public.app_news_article_bodies')::text,'absent') as definition
union all select 'table','public.app_news_reads',coalesce(to_regclass('public.app_news_reads')::text,'absent')
union all select 'table','public.app_news_now_details',coalesce(to_regclass('public.app_news_now_details')::text,'absent')
union all select 'table','public.app_news_now_signals',coalesce(to_regclass('public.app_news_now_signals')::text,'absent')
union all select 'table','public.app_news_id_map',coalesce(to_regclass('public.app_news_id_map')::text,'absent')
union all select 'function','public.app_news_article_of(uuid[])',coalesce(to_regprocedure('public.app_news_article_of(uuid[])')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261115140000'
order by 1,2;
