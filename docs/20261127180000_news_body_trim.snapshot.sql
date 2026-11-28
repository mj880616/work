-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 새 함수가 아직 없음·지우기 함수 정의 해시·두 본문 표 검사를 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in (to_regprocedure('public.app_news_prune(timestamptz,integer)'),to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)'))
union all select 'body constraint',c.conrelid::regclass::text||'.'||c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid in (to_regclass('public.app_news_article_bodies'),to_regclass('public.app_feed_bodies'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261120130000','20261122230000','20261127180000')
order by 1,2,3;
