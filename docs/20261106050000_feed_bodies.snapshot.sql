-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표·트리거 함수가 아직 없음과, 이 표가 가리키는 두 글 표의 정책·트리거 개수(바뀌지 않아야 함)를 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_feed_bodies','public.app_outside_posts','public.app_news_items']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_feed_bodies_scope_guard()','private.app_is_workspace_owner(uuid)']) n
union all select 'item table policies',c.relname::text,(select count(*) from pg_policy p where p.polrelid=c.oid)::text
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'item table triggers',c.relname::text,(select count(*) from pg_trigger g where g.tgrelid=c.oid and not g.tgisinternal)::text
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'item table ACL md5',c.relname::text,md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261106050000'
order by 1,2;
