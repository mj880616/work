-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 함수가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind,'public.app_news_refs_sync(integer)' as name,coalesce(to_regprocedure('public.app_news_refs_sync(integer)')::text,'absent') as definition
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261115160000'
order by 1,2;
