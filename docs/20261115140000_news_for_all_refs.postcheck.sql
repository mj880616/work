-- SELECT only. Run after apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 뒤 기대: 예/아니오 항목은 모두 예. 줄 수는 기록(사전 확인과 같거나 수집기 몫만큼 많음).
-- expect: history row present = 예
-- expect: new tables RLS on, no anon or PUBLIC privilege = 예
-- expect: id map: no screen privilege = 예
-- expect: bodies and details: screen read only = 예
-- expect: reads and signals: owner policies, screen insert columns only = 예
-- expect: bodies policy goes through shared article policies = 예
-- expect: map function definer, fixed search_path, authenticated only = 예
-- expect: every old item mapped to the same url = 예
-- expect: no orphan per-person rows = 예
-- expect: items rows = 기록
-- expect: map rows = 기록
-- expect: body rows = 기록
-- expect: read rows = 기록
-- expect: detail rows = 기록
-- expect: signal rows = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115140000' and name='news_for_all_refs')=1 then '예' else '아니오' end as value
union all select 'new tables RLS on, no anon or PUBLIC privilege',case when (select count(*) from pg_class where oid in (to_regclass('public.app_news_article_bodies'),to_regclass('public.app_news_reads'),to_regclass('public.app_news_now_details'),to_regclass('public.app_news_now_signals'),to_regclass('public.app_news_id_map')) and relrowsecurity and coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=')=5 and not exists(select 1 from unnest(array['public.app_news_article_bodies','public.app_news_reads','public.app_news_now_details','public.app_news_now_signals','public.app_news_id_map']) t(n) where has_any_column_privilege('anon',t.n,'select,insert,update,references') or has_table_privilege('anon',t.n,'delete')) then '예' else '아니오' end
union all select 'id map: no screen privilege',case when not has_any_column_privilege('authenticated','public.app_news_id_map','select,insert,update,references') and not has_table_privilege('authenticated','public.app_news_id_map','delete') and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_news_id_map')) and has_table_privilege('service_role','public.app_news_id_map','select,insert') and not has_table_privilege('service_role','public.app_news_id_map','update,delete') then '예' else '아니오' end
union all select 'bodies and details: screen read only',case when has_table_privilege('authenticated','public.app_news_article_bodies','select') and has_table_privilege('authenticated','public.app_news_now_details','select') and not has_any_column_privilege('authenticated','public.app_news_article_bodies','insert,update') and not has_any_column_privilege('authenticated','public.app_news_now_details','insert,update') and not has_table_privilege('authenticated','public.app_news_article_bodies','delete') and not has_table_privilege('authenticated','public.app_news_now_details','delete') then '예' else '아니오' end
union all select 'reads and signals: owner policies, screen insert columns only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_reads') and polroles=array['authenticated'::regrole]::oid[] and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) like '%app_is_workspace_owner(workspace_id)%')=3 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_now_signals') and polroles=array['authenticated'::regrole]::oid[] and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) like '%app_is_workspace_owner(workspace_id)%')=2 and not has_any_column_privilege('authenticated','public.app_news_reads','update') and not has_any_column_privilege('authenticated','public.app_news_now_signals','update') and not has_column_privilege('authenticated','public.app_news_reads','read_at','insert') and not has_column_privilege('authenticated','public.app_news_now_signals','created_at','insert') then '예' else '아니오' end
union all select 'bodies policy goes through shared article policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_article_bodies'))=1 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_article_bodies') and polcmd='r' and polpermissive and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_news_articles%')=1 then '예' else '아니오' end
union all select 'map function definer, fixed search_path, authenticated only',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_news_article_of(uuid[])') and prosecdef and proconfig=array['search_path=""'] and coalesce(proacl::text,'') !~ '(^|[{,])=')=1 and has_function_privilege('authenticated','public.app_news_article_of(uuid[])','execute') and not has_function_privilege('anon','public.app_news_article_of(uuid[])','execute') and not has_function_privilege('service_role','public.app_news_article_of(uuid[])','execute') then '예' else '아니오' end
union all select 'every old item mapped to the same url',case when not exists(select 1 from public.app_news_items i where not exists(select 1 from public.app_news_id_map m join public.app_news_articles a on a.id=m.article_id where m.old_id=i.id and a.url_key=i.url_key and m.workspace_id=i.workspace_id)) then '예' else '아니오' end
union all select 'no orphan per-person rows',case when not exists(select 1 from public.app_news_reads n where not exists(select 1 from public.app_news_articles a where a.id=n.article_id)) and not exists(select 1 from public.app_news_now_details n where not exists(select 1 from public.app_news_articles a where a.id=n.article_id)) and not exists(select 1 from public.app_news_now_signals n where not exists(select 1 from public.app_news_articles a where a.id=n.article_id)) then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'map rows',(select count(*)::text from public.app_news_id_map)
union all select 'body rows',(select count(*)::text from public.app_news_article_bodies)
union all select 'read rows',(select count(*)::text from public.app_news_reads)
union all select 'detail rows',(select count(*)::text from public.app_news_now_details)
union all select 'signal rows',(select count(*)::text from public.app_news_now_signals);
