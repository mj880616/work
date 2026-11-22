-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 검색 함수(정의 해시·옵션·권한), 밑줄 종류 검사 정의, 밑줄 표 권한, 새 표가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'search function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.proname='app_search_records' and p.pronamespace='public'::regnamespace
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'highlight check',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_news_highlights') and c.contype='c'
union all select 'highlight table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.oid=to_regclass('public.app_news_highlights')
union all select 'table','public.app_reading_items',coalesce(to_regclass('public.app_reading_items')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261029061500','20261115194000','20261122100000')
order by 1,2;
