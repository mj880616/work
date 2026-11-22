-- SELECT only. pg_catalog·migration 기록과 줄 개수만 읽는다(내용 없음). 적용 뒤 예/아니오는 모두 예, 같은 이름 개수는 사전 값과 같아야 한다.
-- 옮긴 줄 수(어디서 왔나 news·outside, 연결 수)는 숫자로만 남긴다.
-- expect: reading rows from news = 0~10000000
-- expect: reading rows from outside = 0~10000000
-- expect: reading rows linked to news = 0~10000000
-- expect: reading rows linked to outside = 0~10000000
-- expect: reading rows now = 0~10000000
with t as (select to_regclass('public.app_reading_items') as t)
select 'columns, checks, indexes and history agree' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261122230000' and name='reading_one_store')=1
  and (select count(*) from pg_attribute,t where attrelid=t.t and attname in('origin','news_article_id','outside_article_id') and not attisdropped)=3
  and (select count(*) from pg_constraint,t where conrelid=t.t and conname in('app_reading_items_origin_check','app_reading_items_one_article_check',
    'app_reading_items_news_article_fkey','app_reading_items_outside_article_fkey'))=4
  and (select count(*) from pg_indexes where schemaname='public' and tablename='app_reading_items' and indexname in('app_reading_items_news_unique',
    'app_reading_items_outside_unique','app_reading_items_news_article_idx','app_reading_items_outside_article_idx'))=4 then '예' else '아니오' end as value
union all select 'folder star check gone',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_news_marks') and conname='app_news_marks_folder_star_check') then '예' else '아니오' end
union all select 'keep: definer, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)')
    and prosecdef and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])=')
  and has_function_privilege('authenticated',to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'),'execute')
  and not has_function_privilege('anon',to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'),'execute')
  and not has_function_privilege('service_role',to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'),'execute') then '예' else '아니오' end
union all select 'helpers: invoker, nobody can call them directly',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'),
    to_regprocedure('private.app_reading_body(text,uuid)')) and not prosecdef and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])=')=2
  and not has_function_privilege('authenticated',to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'),'execute')
  and not has_function_privilege('service_role',to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'),'execute')
  and not has_function_privilege('anon',to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'),'execute')
  and not has_function_privilege('authenticated',to_regprocedure('private.app_reading_body(text,uuid)'),'execute')
  and not has_function_privilege('anon',to_regprocedure('private.app_reading_body(text,uuid)'),'execute') then '예' else '아니오' end
union all select 'phone save and prune use reading rows, service_role only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)') and prosecdef and md5(prosrc)='e8f32b5ecdd8933ca542d1a6ea8b510c')
  and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_outside_prune(timestamptz,integer)') and prosecdef and md5(prosrc)='cbaf8e1787b6068a722e8ff6db7e8495')
  and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') and prosecdef and md5(prosrc)='040259503addb92d386f3b9c6da5acbf')
  and not has_function_privilege('authenticated',to_regprocedure('public.app_news_prune(timestamptz,integer)'),'execute')
  and not has_function_privilege('authenticated',to_regprocedure('public.app_outside_prune(timestamptz,integer)'),'execute')
  and not has_function_privilege('authenticated',to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)'),'execute')
  and has_function_privilege('service_role',to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)'),'execute') then '예' else '아니오' end
union all select 'reading: one owner policy, no direct writes to the new columns',case when (select count(*) from pg_policy,t where polrelid=t.t)=1
  and not has_column_privilege('authenticated',(select t from t),'origin','insert,update')
  and not has_column_privilege('authenticated',(select t from t),'news_article_id','insert,update')
  and not has_column_privilege('authenticated',(select t from t),'outside_article_id','insert,update')
  and not has_table_privilege('anon',(select t from t),'select,insert,update,delete')
  and not has_table_privilege('service_role',(select t from t),'select,insert,update,delete') then '예' else '아니오' end
union all select 'every saved article is in reading',case when not exists(select 1 from public.app_news_marks m join public.app_news_articles a on a.id=m.article_id
    where m.starred_at is not null and not exists(select 1 from public.app_reading_items r where r.workspace_id=m.workspace_id and (r.news_article_id=a.id or r.url=a.url)))
  and not exists(select 1 from public.app_outside_article_marks m join public.app_outside_articles a on a.id=m.article_id
    where (m.starred_at is not null or m.archived_at is not null) and not exists(select 1 from public.app_reading_items r where r.workspace_id=m.workspace_id and (r.outside_article_id=a.id or r.url=a.url))) then '예' else '아니오' end
union all select 'no row points at two articles',case when not exists(select 1 from public.app_reading_items r where r.news_article_id is not null and r.outside_article_id is not null) then '예' else '아니오' end
union all select 'news stars',(select count(*)::text from public.app_news_marks where starred_at is not null)
union all select 'outside saves',(select count(*)::text from public.app_outside_article_marks where starred_at is not null or archived_at is not null)
union all select 'news highlights',(select count(*)::text from public.app_news_highlights where source_type='news')
union all select 'outside highlights',(select count(*)::text from public.app_news_highlights where source_type='outside')
union all select 'reading highlights',(select count(*)::text from public.app_news_highlights where source_type='reading')
union all select 'reading rows from news',(select count(*)::text from public.app_reading_items where origin='news')
union all select 'reading rows from outside',(select count(*)::text from public.app_reading_items where origin='outside')
union all select 'reading rows linked to news',(select count(*)::text from public.app_reading_items where news_article_id is not null)
union all select 'reading rows linked to outside',(select count(*)::text from public.app_reading_items where outside_article_id is not null)
union all select 'reading rows now',(select count(*)::text from public.app_reading_items);
