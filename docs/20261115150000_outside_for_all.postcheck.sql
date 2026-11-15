-- SELECT only. Run after apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 뒤 기대: 예/아니오 항목은 모두 예. 줄 수는 기록.
-- expect: history row present = 예
-- expect: new tables RLS on, no anon or PUBLIC privilege = 예
-- expect: shared articles and sentences: members read only = 예
-- expect: id map: no screen privilege = 예
-- expect: per-person tables owner policies = 예
-- expect: functions shape and execute as planned = 예
-- expect: every old post mapped to the same url = 예
-- expect: no orphan per-person rows = 예
-- expect: post rows = 기록
-- expect: article rows = 기록
-- expect: article sentence rows = 기록
-- expect: map rows = 기록
-- expect: article mark rows = 기록
-- expect: article body rows = 기록
-- expect: read rows = 기록
-- expect: detail rows = 기록
-- expect: signal rows = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115150000' and name='outside_for_all')=1 then '예' else '아니오' end as value
union all select 'new tables RLS on, no anon or PUBLIC privilege',case when (select count(*) from pg_class where oid in (select to_regclass(x.n) from unnest(array['public.app_outside_articles','public.app_outside_article_sentences','public.app_outside_article_marks','public.app_outside_article_bodies','public.app_outside_reads','public.app_outside_now_details','public.app_outside_now_signals','public.app_outside_id_map']) x(n)) and relrowsecurity and coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=')=8 and not exists(select 1 from unnest(array['public.app_outside_articles','public.app_outside_article_sentences','public.app_outside_article_marks','public.app_outside_article_bodies','public.app_outside_reads','public.app_outside_now_details','public.app_outside_now_signals','public.app_outside_id_map']) x(n) where has_any_column_privilege('anon',x.n,'select,insert,update,references') or has_table_privilege('anon',x.n,'delete')) then '예' else '아니오' end
union all select 'shared articles and sentences: members read only',case when not exists(select 1 from unnest(array['public.app_outside_articles','public.app_outside_article_sentences','public.app_outside_article_bodies']) x(n) where not has_table_privilege('authenticated',x.n,'select') or has_any_column_privilege('authenticated',x.n,'insert,update') or has_table_privilege('authenticated',x.n,'delete')) and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_outside_articles'),to_regclass('public.app_outside_article_sentences')) and polcmd='r' and polpermissive and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_news_reader_ok()%')=2 and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_outside_articles'),to_regclass('public.app_outside_article_sentences'),to_regclass('public.app_outside_article_bodies')))=3 then '예' else '아니오' end
union all select 'id map: no screen privilege',case when not has_any_column_privilege('authenticated','public.app_outside_id_map','select,insert,update,references') and not has_table_privilege('authenticated','public.app_outside_id_map','delete') and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_outside_id_map')) and not has_table_privilege('service_role','public.app_outside_id_map','update,delete') then '예' else '아니오' end
union all select 'per-person tables owner policies',case when (select count(*) from pg_policy where polrelid in (to_regclass('public.app_outside_article_marks'),to_regclass('public.app_outside_reads'),to_regclass('public.app_outside_now_details'),to_regclass('public.app_outside_now_signals')) and polroles=array['authenticated'::regrole]::oid[] and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) like '%app_is_workspace_owner(workspace_id)%')=7 and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_outside_article_marks'),to_regclass('public.app_outside_reads'),to_regclass('public.app_outside_now_details'),to_regclass('public.app_outside_now_signals')))=7 and not has_any_column_privilege('authenticated','public.app_outside_now_details','insert,update') and not has_column_privilege('authenticated','public.app_outside_article_marks','article_id','update') then '예' else '아니오' end
union all select 'functions shape and execute as planned',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_article_of(uuid[])') and prosecdef and proconfig=array['search_path=""'] and coalesce(proacl::text,'') !~ '(^|[{,])=')=1 and (select count(*) from pg_proc where oid=to_regprocedure('public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)') and not prosecdef and proconfig=array['search_path=""'] and coalesce(proacl::text,'') !~ '(^|[{,])=')=1 and has_function_privilege('authenticated','public.app_outside_article_of(uuid[])','execute') and has_function_privilege('authenticated','public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)','execute') and not has_function_privilege('anon','public.app_outside_article_of(uuid[])','execute') and not has_function_privilege('anon','public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)','execute') and not has_function_privilege('service_role','public.app_outside_article_of(uuid[])','execute') then '예' else '아니오' end
union all select 'every old post mapped to the same url',case when not exists(select 1 from public.app_outside_posts p where not exists(select 1 from public.app_outside_id_map m join public.app_outside_articles a on a.id=m.article_id where m.old_id=p.id and a.url=p.url and m.workspace_id=p.workspace_id)) then '예' else '아니오' end
union all select 'no orphan per-person rows',case when not exists(select 1 from public.app_outside_article_marks n where not exists(select 1 from public.app_outside_articles a where a.id=n.article_id)) and not exists(select 1 from public.app_outside_reads n where not exists(select 1 from public.app_outside_articles a where a.id=n.article_id)) and not exists(select 1 from public.app_outside_now_details n where not exists(select 1 from public.app_outside_articles a where a.id=n.article_id)) then '예' else '아니오' end
union all select 'post rows',(select count(*)::text from public.app_outside_posts)
union all select 'article rows',(select count(*)::text from public.app_outside_articles)
union all select 'article sentence rows',(select count(*)::text from public.app_outside_article_sentences)
union all select 'map rows',(select count(*)::text from public.app_outside_id_map)
union all select 'article mark rows',(select count(*)::text from public.app_outside_article_marks)
union all select 'article body rows',(select count(*)::text from public.app_outside_article_bodies)
union all select 'read rows',(select count(*)::text from public.app_outside_reads)
union all select 'detail rows',(select count(*)::text from public.app_outside_now_details)
union all select 'signal rows',(select count(*)::text from public.app_outside_now_signals);
