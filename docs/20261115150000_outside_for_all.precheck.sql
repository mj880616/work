-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수는 기록만 한다(수집기가 도는 중이면 적용 사이에 늘 수 있음).
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: new tables and functions absent = 예
-- expect: reader function as D1 = 예
-- expect: post rows = 기록
-- expect: distinct urls = 기록
-- expect: sentence rows = 기록
-- expect: mark rows = 기록
-- expect: outside body rows = 기록
-- expect: outside read rows = 기록
-- expect: outside detail rows = 기록
-- expect: outside signal rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115150000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261115100000','news_for_all'),('20261031230000','outside_statements'),('20261102150000','outside_search_undated'),('20261108020000','outside_post_body_ko'),('20261102140000','now_detail'),('20261106050000','feed_bodies'),('20261106080000','feed_reads_news_prefs')))=7 then '예' else '아니오' end
union all select 'new tables and functions absent',case when not exists(select 1 from unnest(array['public.app_outside_articles','public.app_outside_article_sentences','public.app_outside_article_marks','public.app_outside_article_bodies','public.app_outside_reads','public.app_outside_now_details','public.app_outside_now_signals','public.app_outside_id_map']) x(n) where to_regclass(x.n) is not null) and to_regprocedure('public.app_outside_article_of(uuid[])') is null and to_regprocedure('public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)') is null then '예' else '아니오' end
union all select 'reader function as D1',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_news_reader_ok()') and prosecdef and proconfig=array['search_path=""']) and has_function_privilege('authenticated','private.app_news_reader_ok()','execute') and not has_function_privilege('anon','private.app_news_reader_ok()','execute') then '예' else '아니오' end
union all select 'post rows',(select count(*)::text from public.app_outside_posts)
union all select 'distinct urls',(select count(distinct url)::text from public.app_outside_posts)
union all select 'sentence rows',(select count(*)::text from public.app_outside_sentences)
union all select 'mark rows',(select count(*)::text from public.app_outside_marks)
union all select 'outside body rows',(select count(*)::text from public.app_feed_bodies where outside_post_id is not null)
union all select 'outside read rows',(select count(*)::text from public.app_feed_reads where outside_post_id is not null)
union all select 'outside detail rows',(select count(*)::text from public.app_now_details where outside_post_id is not null)
union all select 'outside signal rows',(select count(*)::text from public.app_now_signals where outside_post_id is not null);
