-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 검색 함수(정의 해시·옵션·권한)와 이번·이전 기록을 남긴다(되돌린 뒤 같은지 대조).
select 'search function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.proname='app_search_records' and p.pronamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261122100000','20261126180000')
order by 1,2;
