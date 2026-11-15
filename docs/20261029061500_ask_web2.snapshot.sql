-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 검색 함수(정의 해시·옵션·권한)와 새 표가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'search function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.proname='app_search_records' and p.pronamespace='public'::regnamespace
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'table','public.app_ask_answers',coalesce(to_regclass('public.app_ask_answers')::text,'absent')
union all select 'feed table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_feed_items','app_call_edits','app_feed_summary_edits','app_feed_room_days')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261023013000','20261029061500')
order by 1,2;
