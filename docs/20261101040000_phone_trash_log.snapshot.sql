-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_phone_trash_log' as name,coalesce(to_regclass('public.app_phone_trash_log')::text,'absent') as definition
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261101040000'
order by 1,2;
