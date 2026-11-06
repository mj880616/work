-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표가 아직 없음과, 칸을 더하는 상세 표(app_now_details)의 칸·검사·정책·트리거·권한 모양을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_feed_ai_days','public.app_now_details']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_is_workspace_owner(uuid)']) n
union all select 'detail columns',c.relname::text,(select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' order by a.attnum)
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)
  from pg_class c where c.oid=to_regclass('public.app_now_details')
union all select 'detail constraints md5',c.relname::text,(select md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),'|' order by conname),'none'))
    from pg_constraint where conrelid=c.oid)
  from pg_class c where c.oid=to_regclass('public.app_now_details')
union all select 'detail policies',c.relname::text,(select count(*) from pg_policy p where p.polrelid=c.oid)::text
  from pg_class c where c.oid=to_regclass('public.app_now_details')
union all select 'detail triggers',c.relname::text,(select count(*) from pg_trigger g where g.tgrelid=c.oid and not g.tgisinternal)::text
  from pg_class c where c.oid=to_regclass('public.app_now_details')
union all select 'detail ACL md5',c.relname::text,md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.oid=to_regclass('public.app_now_details')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261106100000'
order by 1,2;
