-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·공용 기사 출처별 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migration 예 / origin check without user 예 / two article policies 예 / no save_n 예 / new functions absent 예 / only known origins 예 / user rows 0.
-- expect: recent migrations = 기록
-- expect: user rows = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115230000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261115100000' and name='news_for_all') then '예' else '아니오' end
union all select 'origin check without user',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_articles')
  and conname='app_news_articles_origin_check' and pg_get_constraintdef(oid) ~ '''tg_scrap''' and pg_get_constraintdef(oid) !~ '''user''')=1 then '예' else '아니오' end
union all select 'two article policies',case when (select count(*) from pg_policies where schemaname='public' and tablename='app_news_articles')=2
  and (select count(*) from pg_policies where schemaname='public' and tablename='app_news_articles' and policyname='news_articles_reader_select'
   and cmd='SELECT' and permissive='PERMISSIVE' and roles=array['authenticated']::name[])=1 then '예' else '아니오' end
union all select 'no save_n',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_days') and attname='save_n' and not attisdropped) then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('private.app_news_marked_by_me(uuid)') is null and to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') is null then '예' else '아니오' end
union all select 'only known origins',case when not exists(select 1 from public.app_news_articles where origin not in ('site','tg_room','tg_scrap')) then '예' else '아니오' end
union all select 'user rows',(select count(*) from public.app_news_articles where origin='user')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
