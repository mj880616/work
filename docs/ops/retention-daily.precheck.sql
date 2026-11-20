-- S67-24 DB-보관기간정리 ② 미리 보기 (읽기 전용, SQL Editor 새 창). 숫자·크기·백업 표 이름만 보여 준다(기사 제목·내용·누구 것인지는 읽지 않음).
-- 언제: retention-daily.apply.sql 조각 ① 전, 조각 ② 전, VACUUM 뒤(크기 비교) — 세 번 같은 것을 실행해 캡처한다.
-- 'older' 줄 수는 정리 규칙의 나이만 본 수다(별표·보관·메모·밑줄·직접 넣은 기사는 이 가운데서도 남는다).
select 'database size MB' as item, round(pg_database_size(current_database()) / 1048576.0, 1)::text as value
union all select 'size MB ' || c.oid::regclass::text, round(pg_total_relation_size(c.oid) / 1048576.0, 1)::text
  from pg_class c
 where c.oid in (to_regclass('public.app_news_items'), to_regclass('public.app_news_articles'), to_regclass('public.app_news_article_bodies'),
                 to_regclass('public.app_feed_bodies'), to_regclass('public.app_outside_posts'), to_regclass('public.app_outside_articles'),
                 to_regclass('public.app_outside_sentences'), to_regclass('public.app_outside_article_sentences'), to_regclass('public.app_outside_article_bodies'),
                 to_regclass('public.app_news_marks'), to_regclass('public.app_news_id_map'), to_regclass('public.app_outside_id_map'),
                 to_regclass('cron.job_run_details'))
union all select 'news articles older than 72h', (select count(*) from public.app_news_articles where created_at < now() - interval '72 hours')::text
union all select 'news articles total', (select count(*) from public.app_news_articles)::text
union all select 'old news items older than 72h', (select count(*) from public.app_news_items where created_at < now() - interval '72 hours')::text
union all select 'old news items total', (select count(*) from public.app_news_items)::text
union all select 'outside articles older than 6 months', (select count(*) from public.app_outside_articles where fetched_at < now() - interval '6 months')::text
union all select 'outside articles total', (select count(*) from public.app_outside_articles)::text
union all select 'old outside posts older than 6 months', (select count(*) from public.app_outside_posts where fetched_at < now() - interval '6 months')::text
union all select 'old outside posts total', (select count(*) from public.app_outside_posts)::text
union all select 'cron run rows older than 7 days', (select count(*) from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days')::text
union all select 'cron run rows total', (select count(*) from cron.job_run_details)::text
union all select 'retention job present', case when exists (select 1 from cron.job where jobname = 'web2_retention_daily') then '예' else '아니오' end
union all select 'retention migration recorded', case when exists (select 1 from supabase_migrations.schema_migrations where version = '20261120130000') then '예' else '아니오' end
-- 백업 사본: 이름(= migration 번호_표_실행 번호)·크기·그 migration 기록 여부·조각 ②에서 한 번 지울 대상인지.
union all select 'backup ' || c.relname,
       round(pg_total_relation_size(c.oid) / 1048576.0, 1)::text || 'MB'
       || case when exists (select 1 from supabase_migrations.schema_migrations m where m.version = left(c.relname, 14)) then ' 기록있음' else ' 기록없음' end
       || case when c.relname ~ '^(20261115|20261116|20261119)[0-9]{6}_app_(news|outside|feed_bodies)[a-z0-9_]*_[0-9]+$'
                and exists (select 1 from supabase_migrations.schema_migrations m where m.version = left(c.relname, 14)) then ' 지금지움' else ' 14일규칙' end
  from pg_class c
 where c.relnamespace = to_regnamespace('ops_backup') and c.relkind = 'r'
order by 1;
