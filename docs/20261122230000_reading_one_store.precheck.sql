-- SELECT only. Run before dry-run/apply (approved DB workflow or SQL Editor, phone path C). pg_catalog·migration 기록과 줄 개수만 읽는다(내용 없음).
-- 적용 전 기대: 예/아니오 항목 모두 예. 개수·최근 기록은 값만 남긴다(사후 확인이 같은 이름 개수와 대조).
-- expect: news stars = 기록
-- expect: outside saves = 기록
-- expect: reading rows = 기록
-- expect: news highlights = 기록
-- expect: outside highlights = 기록
-- expect: reading highlights = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261122230000') then '예' else '아니오' end as value
union all select 'reading items migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261122100000' and name='reading_items')=1 then '예' else '아니오' end
union all select 'retention migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261120130000' and name='news_outside_retention')=1 then '예' else '아니오' end
union all select 'phone save migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261115230000' and name='news_user_save')=1 then '예' else '아니오' end
union all select 'news prune is the file text version',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)')
  and prosecdef and proconfig=array['search_path=""'] and md5(prosrc)='e4809791a51e703fe5fb6238309e6b5f') then '예' else '아니오' end
union all select 'outside prune is the file text version',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_outside_prune(timestamptz,integer)')
  and prosecdef and proconfig=array['search_path=""'] and md5(prosrc)='c42fd96f95583096459b4e5a35c08cea') then '예' else '아니오' end
union all select 'phone save is the file text version',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)')
  and prosecdef and proconfig=array['search_path=""'] and md5(prosrc)='be2c718c174a95885ee940d3bc46c45e') then '예' else '아니오' end
union all select 'reading new columns absent',case when to_regclass('public.app_reading_items') is not null and not exists(select 1 from pg_attribute
  where attrelid=to_regclass('public.app_reading_items') and attname in('origin','news_article_id','outside_article_id') and not attisdropped) then '예' else '아니오' end
union all select 'folder star check present',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_marks') and conname='app_news_marks_folder_star_check')=1 then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)') is null
  and to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)') is null and to_regprocedure('private.app_reading_body(text,uuid)') is null then '예' else '아니오' end
union all select 'owner, feature and reader functions',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
  and to_regprocedure('private.app_news_reader_ok()') is not null and to_regprocedure('private.app_news_scrap_reader_ok()') is not null then '예' else '아니오' end
union all select 'reading: one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_reading_items'))=1 then '예' else '아니오' end
union all select 'every saved article has a usable address',case when not exists(select 1 from public.app_news_marks m join public.app_news_articles a on a.id=m.article_id
    where m.starred_at is not null and not (a.url ~ '^https?://[^[:space:][:cntrl:]]+$' and char_length(a.url)<=2000))
  and not exists(select 1 from public.app_outside_article_marks m join public.app_outside_articles a on a.id=m.article_id
    where (m.starred_at is not null or m.archived_at is not null) and not (a.url ~ '^https?://[^[:space:][:cntrl:]]+$' and char_length(a.url)<=2000)) then '예' else '아니오' end
union all select 'news stars',(select count(*)::text from public.app_news_marks where starred_at is not null)
union all select 'outside saves',(select count(*)::text from public.app_outside_article_marks where starred_at is not null or archived_at is not null)
union all select 'reading rows',(select count(*)::text from public.app_reading_items)
union all select 'news highlights',(select count(*)::text from public.app_news_highlights where source_type='news')
union all select 'outside highlights',(select count(*)::text from public.app_news_highlights where source_type='outside')
union all select 'reading highlights',(select count(*)::text from public.app_news_highlights where source_type='reading')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
