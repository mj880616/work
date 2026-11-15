-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표·칸·함수가 아직 없음과 방 표 칸 목록을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_news_articles' as name,coalesce(to_regclass('public.app_news_articles')::text,'absent') as definition
union all select 'table','public.app_news_marks',coalesce(to_regclass('public.app_news_marks')::text,'absent')
union all select 'function','private.app_news_reader_ok()',coalesce(to_regprocedure('private.app_news_reader_ok()')::text,'absent')
union all select 'function','private.app_news_scrap_reader_ok()',coalesce(to_regprocedure('private.app_news_scrap_reader_ok()')::text,'absent')
union all select 'function','public.app_feed_room_news(text,boolean)',coalesce(to_regprocedure('public.app_feed_room_news(text,boolean)')::text,'absent')
union all select 'function','public.app_news_room_take(uuid,text,jsonb)',coalesce(to_regprocedure('public.app_news_room_take(uuid,text,jsonb)')::text,'absent')
union all select 'columns','public.app_feed_rooms',coalesce((select string_agg(a.attname::text||' '||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum) from pg_attribute a where a.attrelid=to_regclass('public.app_feed_rooms') and a.attnum>0 and not a.attisdropped),'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261115100000'
order by 1,2;
