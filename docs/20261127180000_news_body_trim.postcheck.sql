-- SELECT only. pg_catalog·migration 기록과 줄 개수만 읽는다(내용 없음). 적용 뒤 예/아니오는 모두 예, 비운 표시 줄 수는 사전 값과 같아야 한다(적용 순간에는 비우지 않음).
-- expect: news articles size MB = 기록
-- expect: news items size MB = 기록
-- expect: news article bodies size MB = 기록
-- expect: feed bodies size MB = 기록
-- expect: database size MB = 기록
select 'history row' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261127180000' and name='news_body_trim')=1 then '예' else '아니오' end as value
union all select 'trim: definer, empty search_path, service_role only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)')
    and prosecdef and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])=')
  and has_function_privilege('service_role',to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)'),'execute')
  and not has_function_privilege('authenticated',to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)'),'execute')
  and not has_function_privilege('anon',to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)'),'execute') then '예' else '아니오' end
union all select 'news prune unchanged',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)')
  and md5(prosrc)='e8f32b5ecdd8933ca542d1a6ea8b510c') then '예' else '아니오' end
union all select 'trim marker rows',(select (select count(*) from public.app_news_article_bodies where rule='trim@1')+(select count(*) from public.app_feed_bodies where rule='trim@1'))::text
union all select 'news articles size MB',(select round(pg_total_relation_size('public.app_news_articles')/1048576.0,1)::text)
union all select 'news items size MB',(select round(pg_total_relation_size('public.app_news_items')/1048576.0,1)::text)
union all select 'news article bodies size MB',(select round(pg_total_relation_size('public.app_news_article_bodies')/1048576.0,1)::text)
union all select 'feed bodies size MB',(select round(pg_total_relation_size('public.app_feed_bodies')/1048576.0,1)::text)
union all select 'database size MB',(select round(pg_database_size(current_database())/1048576.0)::text);
