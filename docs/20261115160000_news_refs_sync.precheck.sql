-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수는 기록만 한다(수집기가 도는 중이면 적용 사이에 늘 수 있음).
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: D2 tables present, sync function absent = 예
-- expect: shared articles and id map guarded as D2 = 예
-- expect: items rows = 기록
-- expect: unmapped old items = 기록
-- expect: old only url keys = 기록
-- expect: map rows = 기록
-- expect: body rows = 기록
-- expect: read rows = 기록
-- expect: detail rows = 기록
-- expect: signal rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115160000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261115100000','news_for_all'),('20261115140000','news_for_all_refs')))=2 then '예' else '아니오' end
union all select 'D2 tables present, sync function absent',case when to_regclass('public.app_news_id_map') is not null and to_regclass('public.app_news_article_bodies') is not null and to_regclass('public.app_news_reads') is not null and to_regclass('public.app_news_now_details') is not null and to_regclass('public.app_news_now_signals') is not null and to_regprocedure('public.app_news_refs_sync(integer)') is null then '예' else '아니오' end
union all select 'shared articles and id map guarded as D2',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relrowsecurity) and not has_table_privilege('authenticated','public.app_news_articles','insert,update,delete') and not has_any_column_privilege('authenticated','public.app_news_id_map','select,insert,update,references') and not has_any_column_privilege('anon','public.app_news_id_map','select,insert,update,references') then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'unmapped old items',(select count(*)::text from public.app_news_items i where not exists(select 1 from public.app_news_id_map m where m.old_id=i.id))
union all select 'old only url keys',(select count(distinct i.url_key)::text from public.app_news_items i where not exists(select 1 from public.app_news_articles a where a.url_key=i.url_key))
union all select 'map rows',(select count(*)::text from public.app_news_id_map)
union all select 'body rows',(select count(*)::text from public.app_news_article_bodies)
union all select 'read rows',(select count(*)::text from public.app_news_reads)
union all select 'detail rows',(select count(*)::text from public.app_news_now_details)
union all select 'signal rows',(select count(*)::text from public.app_news_now_signals);
