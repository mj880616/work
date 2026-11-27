-- SELECT only. Run before dry-run/apply (approved DB workflow or SQL Editor, phone path C). pg_catalog·migration 기록과 줄 개수만 읽는다(내용 없음).
-- 적용 전 기대: 예/아니오 항목 모두 예. 비운 표시 줄 수는 처음 적용이면 0, 되돌린 뒤 다시 적용이면 남은 수(사후 확인이 같은 값과 대조 — 적용 순간에는 한 줄도 비우지 않음).
-- 표 크기(MB)는 값만 남긴다(효과 추정용, 행 내용 없음).
-- expect: news articles size MB = 기록
-- expect: news items size MB = 기록
-- expect: news article bodies size MB = 기록
-- expect: feed bodies size MB = 기록
-- expect: database size MB = 기록
-- expect: recent migrations = 기록
-- expect: trim marker rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127180000') then '예' else '아니오' end as value
union all select 'retention migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261120130000' and name='news_outside_retention')=1 then '예' else '아니오' end
union all select 'reading one store migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261122230000' and name='reading_one_store')=1 then '예' else '아니오' end
union all select 'news prune is the file text version',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)')
  and prosecdef and proconfig=array['search_path=""'] and md5(prosrc)='e8f32b5ecdd8933ca542d1a6ea8b510c') then '예' else '아니오' end
union all select 'trim function absent',case when to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is null then '예' else '아니오' end
union all select 'body tables and checks present',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_article_bodies')
    and conname in('app_news_article_bodies_state_shape_check','app_news_article_bodies_rule_check','app_news_article_bodies_reason_check'))=3
  and (select count(*) from pg_constraint where conrelid=to_regclass('public.app_feed_bodies')
    and conname in('app_feed_bodies_state_shape_check','app_feed_bodies_rule_check','app_feed_bodies_reason_check'))=3 then '예' else '아니오' end
union all select 'trim marker rows',(select (select count(*) from public.app_news_article_bodies where rule='trim@1')+(select count(*) from public.app_feed_bodies where rule='trim@1'))::text
union all select 'news articles size MB',(select round(pg_total_relation_size('public.app_news_articles')/1048576.0,1)::text)
union all select 'news items size MB',(select round(pg_total_relation_size('public.app_news_items')/1048576.0,1)::text)
union all select 'news article bodies size MB',(select round(pg_total_relation_size('public.app_news_article_bodies')/1048576.0,1)::text)
union all select 'feed bodies size MB',(select round(pg_total_relation_size('public.app_feed_bodies')/1048576.0,1)::text)
union all select 'database size MB',(select round(pg_database_size(current_database())/1048576.0)::text)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
