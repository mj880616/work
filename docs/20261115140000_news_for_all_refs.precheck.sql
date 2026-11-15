-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수는 기록만 한다(수집기가 도는 중이면 적용 사이에 늘 수 있음).
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: new tables and function absent = 예
-- expect: shared articles guarded as D1 = 예
-- expect: items rows = 기록
-- expect: old only url keys = 기록
-- expect: news body rows = 기록
-- expect: news read rows = 기록
-- expect: news detail rows = 기록
-- expect: news signal rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115140000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261115100000','news_for_all'),('20261106050000','feed_bodies'),('20261106080000','feed_reads_news_prefs'),('20261102140000','now_detail')))=4 then '예' else '아니오' end
union all select 'new tables and function absent',case when to_regclass('public.app_news_article_bodies') is null and to_regclass('public.app_news_reads') is null and to_regclass('public.app_news_now_details') is null and to_regclass('public.app_news_now_signals') is null and to_regclass('public.app_news_id_map') is null and to_regprocedure('public.app_news_article_of(uuid[])') is null then '예' else '아니오' end
union all select 'shared articles guarded as D1',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relrowsecurity) and (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_articles'))=2 and not has_table_privilege('authenticated','public.app_news_articles','insert,update,delete') and not has_any_column_privilege('anon','public.app_news_articles','select,insert,update,references') then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'old only url keys',(select count(distinct i.url_key)::text from public.app_news_items i where not exists(select 1 from public.app_news_articles a where a.url_key=i.url_key))
union all select 'news body rows',(select count(*)::text from public.app_feed_bodies where news_item_id is not null)
union all select 'news read rows',(select count(*)::text from public.app_feed_reads where news_item_id is not null)
union all select 'news detail rows',(select count(*)::text from public.app_now_details where news_item_id is not null)
union all select 'news signal rows',(select count(*)::text from public.app_now_signals where news_item_id is not null);
