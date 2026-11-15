-- SELECT only. Run after apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 수집기와 경주하지 않게 '마지막 지도 쓰기 1분 전까지 생긴 옛 줄'만 본다(적용 뒤 Edge E2 배포 전에는 수집기가 지도를 쓰지 않으므로 마지막 지도 쓰기 = 적용 시각,
-- 배포 뒤에는 마지막 보충·수집 시각). 그 뒤 들어온 줄은 다음 news-feed prune 단계 보충이 채운다.
-- 적용 뒤 기대: 예/아니오 항목은 모두 예. 줄 수는 기록(사전 확인과 같거나 많음).
-- expect: history row present = 예
-- expect: sync function definer, fixed search_path, service_role only = 예
-- expect: shared articles and id map guarded as D2 = 예
-- expect: old items before the last map write mapped to the same url = 예
-- expect: no map row across workspace or url = 예
-- expect: per-person rows before the last map write copied = 예
-- expect: items rows = 기록
-- expect: unmapped old items = 기록
-- expect: map rows = 기록
-- expect: body rows = 기록
-- expect: read rows = 기록
-- expect: detail rows = 기록
-- expect: signal rows = 기록
with cut as (select coalesce(max(created_at),now()) - interval '1 minute' as t from public.app_news_id_map)
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115160000' and name='news_refs_sync')=1 then '예' else '아니오' end as value
union all select 'sync function definer, fixed search_path, service_role only',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_news_refs_sync(integer)') and prosecdef and proconfig=array['search_path=""'] and coalesce(proacl::text,'') !~ '(^|[{,])=')=1 and has_function_privilege('service_role','public.app_news_refs_sync(integer)','execute') and not has_function_privilege('anon','public.app_news_refs_sync(integer)','execute') and not has_function_privilege('authenticated','public.app_news_refs_sync(integer)','execute') then '예' else '아니오' end
union all select 'shared articles and id map guarded as D2',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relrowsecurity) and not has_table_privilege('authenticated','public.app_news_articles','insert,update,delete') and not has_any_column_privilege('authenticated','public.app_news_id_map','select,insert,update,references') and not has_any_column_privilege('anon','public.app_news_id_map','select,insert,update,references') then '예' else '아니오' end
union all select 'old items before the last map write mapped to the same url',case when not exists(select 1 from public.app_news_items i,cut where i.created_at<cut.t and not exists(select 1 from public.app_news_id_map m join public.app_news_articles a on a.id=m.article_id where m.old_id=i.id and a.url_key=i.url_key and m.workspace_id=i.workspace_id)) then '예' else '아니오' end
union all select 'no map row across workspace or url',case when not exists(select 1 from public.app_news_id_map m join public.app_news_items i on i.id=m.old_id join public.app_news_articles a on a.id=m.article_id where a.url_key<>i.url_key or m.workspace_id<>i.workspace_id) then '예' else '아니오' end
union all select 'per-person rows before the last map write copied',case when not exists(select 1 from public.app_feed_reads r join public.app_news_id_map m on m.old_id=r.news_item_id and m.workspace_id=r.workspace_id,cut where r.read_at<cut.t and not exists(select 1 from public.app_news_reads n where n.workspace_id=r.workspace_id and n.article_id=m.article_id)) and not exists(select 1 from public.app_now_signals s join public.app_news_id_map m on m.old_id=s.news_item_id and m.workspace_id=s.workspace_id,cut where s.created_at<cut.t and not exists(select 1 from public.app_news_now_signals n where n.id=s.id)) and not exists(select 1 from public.app_now_details d join public.app_news_id_map m on m.old_id=d.news_item_id and m.workspace_id=d.workspace_id,cut where d.generated_at<cut.t and not exists(select 1 from public.app_news_now_details n where n.workspace_id=d.workspace_id and n.article_id=m.article_id and n.generated_at>=d.generated_at)) then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'unmapped old items',(select count(*)::text from public.app_news_items i where not exists(select 1 from public.app_news_id_map m where m.old_id=i.id))
union all select 'map rows',(select count(*)::text from public.app_news_id_map)
union all select 'body rows',(select count(*)::text from public.app_news_article_bodies)
union all select 'read rows',(select count(*)::text from public.app_news_reads)
union all select 'detail rows',(select count(*)::text from public.app_news_now_details)
union all select 'signal rows',(select count(*)::text from public.app_news_now_signals);
