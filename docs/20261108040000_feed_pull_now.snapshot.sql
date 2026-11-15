-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다(앱 표를 읽지 않음).
-- 새 표·함수의 유무와 이번 기록을 남긴다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_feed_pulls' as name,coalesce(to_regclass('public.app_feed_pulls')::text,'absent') as definition
union all select 'function','public.app_feed_pull_take(uuid,uuid,text)',coalesce(to_regprocedure('public.app_feed_pull_take(uuid,uuid,text)')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261108040000'
order by 1,2;
