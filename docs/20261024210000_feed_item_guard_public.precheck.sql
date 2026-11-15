-- SELECT only. Run before dry-run/apply. Aggregates and flags; no row values.
-- 적용 전 기대: 새 기록 없음, 앞 단계(20261024140000) 적용됨, 트리거 함수가 INVOKER·search_path 빈칸·아직 private 함수를 부름(교체 전),
--   트리거 1개, service_role이 확인에 쓰는 네 칸을 읽을 수 있음, 실행권 전부 회수, service_role에 schema private USAGE 없음은 기록만.
-- expect: service_role schema private usage = 기록
-- expect: feed items rows = 기록
-- expect: feed tables grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024210000') then '예' else '아니오' end as value
union all select 'feed table applied (20261024140000)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024140000' and name='call_tg_feed')=1 and to_regclass('public.app_feed_items') is not null then '예' else '아니오' end
union all select 'guard invoker, empty search_path, still calls private',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_feed_item_guard()') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%private.app_space_in_workspace%') then '예' else '아니오' end
union all select 'guard execute revoked from everyone',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_feed_item_guard()') and coalesce(proacl::text,'')!~'(^|[{,])(anon|authenticated|service_role)?=') then '예' else '아니오' end
union all select 'one guard trigger',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_feed_items') and not tgisinternal and tgname='app_feed_items_guard')=1 then '예' else '아니오' end
union all select 'service_role reads the four check columns',case when has_column_privilege('service_role','public.app_spaces','id','select') and has_column_privilege('service_role','public.app_spaces','workspace_id','select')
  and has_column_privilege('service_role','public.app_suborganizations','id','select') and has_column_privilege('service_role','public.app_suborganizations','workspace_id','select') then '예' else '아니오' end
union all select 'authenticated reads the four check columns',case when has_column_privilege('authenticated','public.app_spaces','id','select') and has_column_privilege('authenticated','public.app_spaces','workspace_id','select')
  and has_column_privilege('authenticated','public.app_suborganizations','id','select') and has_column_privilege('authenticated','public.app_suborganizations','workspace_id','select') then '예' else '아니오' end
union all select 'service_role schema private usage',has_schema_privilege('service_role','private','usage')::text
union all select 'feed items rows',(select count(*)::text from public.app_feed_items)
union all select 'feed tables grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'))),''));
