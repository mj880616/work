-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 바뀌는 함수 하나(private.app_feed_item_guard)의 보안·설정·권한·본문 해시, 트리거, 피드 표의 RLS·권한, 확인에 쓰는 표 권한, schema private 권한, 기록.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid=to_regprocedure('private.app_feed_item_guard()')
union all select 'trigger',t.tgname::text,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid=to_regclass('public.app_feed_items') and not t.tgisinternal
union all select 'feed table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'))
union all select 'check table',c.relname::text,coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_spaces'),to_regclass('public.app_suborganizations'))
union all select 'schema private',n.nspname::text,coalesce(n.nspacl::text,'none') from pg_namespace n where n.nspname='private'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261024140000','20261024210000')
order by 1,2;
