-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표·함수가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_outside_articles' as name,coalesce(to_regclass('public.app_outside_articles')::text,'absent') as definition
union all select 'table','public.app_outside_article_sentences',coalesce(to_regclass('public.app_outside_article_sentences')::text,'absent')
union all select 'table','public.app_outside_article_marks',coalesce(to_regclass('public.app_outside_article_marks')::text,'absent')
union all select 'table','public.app_outside_article_bodies',coalesce(to_regclass('public.app_outside_article_bodies')::text,'absent')
union all select 'table','public.app_outside_reads',coalesce(to_regclass('public.app_outside_reads')::text,'absent')
union all select 'table','public.app_outside_now_details',coalesce(to_regclass('public.app_outside_now_details')::text,'absent')
union all select 'table','public.app_outside_now_signals',coalesce(to_regclass('public.app_outside_now_signals')::text,'absent')
union all select 'table','public.app_outside_id_map',coalesce(to_regclass('public.app_outside_id_map')::text,'absent')
union all select 'function','public.app_outside_article_of(uuid[])',coalesce(to_regprocedure('public.app_outside_article_of(uuid[])')::text,'absent')
union all select 'function','public.app_outside_search_shared',coalesce(to_regprocedure('public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261115150000'
order by 1,2;
