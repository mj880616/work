-- S73-01 NEWS-본문하루 ② 읽기 전용 확인(SELECT만) — SQL Editor 또는 승인형 workflow check. 조각 앞뒤로 캡처한다.
-- pg_catalog·migration 기록·예약 표와 줄 개수·표 크기만 읽는다(기사 제목·내용 없음).
select 'trim migration applied' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261127180000' and name='news_body_trim')=1 then '예' else '아니오' end as value
union all select 'trim function present',case when to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is not null then '예' else '아니오' end
union all select 'daily function version',case (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.app_retention_daily()'))
  when 'cc3b09ce4a5868d42dbe5fce4a443619' then '이전(조각 ① 전)' when '4fb863fc9fabc60cd7899fe59308ac0e' then '본문 비우기 포함(조각 ① 뒤)' else '다름(멈추고 보고)' end
union all select 'daily job active',case when (select count(*) from cron.job where jobname='web2_retention_daily' and schedule='43 17 * * *' and active)=1 then '예' else '아니오' end
union all select 'trim marker rows',(select (select count(*) from public.app_news_article_bodies where rule='trim@1')+(select count(*) from public.app_feed_bodies where rule='trim@1'))::text
union all select 'news articles with body',(select count(*)::text from public.app_news_articles where body is not null or body_ko is not null)
union all select 'news articles size MB',(select round(pg_total_relation_size('public.app_news_articles')/1048576.0,1)::text)
union all select 'news items size MB',(select round(pg_total_relation_size('public.app_news_items')/1048576.0,1)::text)
union all select 'news article bodies size MB',(select round(pg_total_relation_size('public.app_news_article_bodies')/1048576.0,1)::text)
union all select 'feed bodies size MB',(select round(pg_total_relation_size('public.app_feed_bodies')/1048576.0,1)::text)
union all select 'database size MB',(select round(pg_database_size(current_database())/1048576.0)::text);
