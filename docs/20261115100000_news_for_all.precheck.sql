-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: new tables, column and functions absent = 예
-- expect: one operator workspace with one owner = 예
-- expect: items RLS on, no anon privilege, no authenticated insert/delete = 예
-- expect: items rows = 기록
-- expect: distinct url keys = 기록
-- expect: marked item rows = 기록
-- expect: rooms rows = 기록
-- expect: rooms grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115100000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261101233000','news_clipping'),('20261108140000','news_titles_tried'),('20261029090000','operator_features'),('20261030060000','tg_room_pin'),('20261105100000','family_notes'),('20261113140000','workspace_signup_allow')))=6 then '예' else '아니오' end
union all select 'new tables, column and functions absent',case when to_regclass('public.app_news_articles') is null and to_regclass('public.app_news_marks') is null and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_feed_rooms') and attname='news_at' and not attisdropped) and to_regprocedure('private.app_news_reader_ok()') is null and to_regprocedure('private.app_news_scrap_reader_ok()') is null and to_regprocedure('public.app_feed_room_news(text,boolean)') is null and to_regprocedure('public.app_news_room_take(uuid,text,jsonb)') is null then '예' else '아니오' end
union all select 'one operator workspace with one owner',case when (select count(distinct workspace_id) from public.app_operator_features where feature='telegram')=1 and (select count(*) from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select workspace_id from public.app_operator_features where feature='telegram'))=1 then '예' else '아니오' end
union all select 'items RLS on, no anon privilege, no authenticated insert/delete',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_items') and relrowsecurity) and not has_any_column_privilege('anon','public.app_news_items','select,insert,update,references') and not has_table_privilege('authenticated','public.app_news_items','insert,delete') then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'distinct url keys',(select count(distinct url_key)::text from public.app_news_items)
union all select 'marked item rows',(select count(*)::text from public.app_news_items where starred_at is not null or folder_id is not null or hidden_at is not null or cardinality(keywords)>0)
union all select 'rooms rows',(select count(*)::text from public.app_feed_rooms)
union all select 'rooms grants policies triggers hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_feed_rooms')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_feed_rooms')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_feed_rooms') and not t.tgisinternal),''));
