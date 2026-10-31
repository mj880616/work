-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표 넷·찾기 함수가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_outside_sources','public.app_outside_posts','public.app_outside_sentences','public.app_outside_seen']) n
union all select 'function','public.app_outside_search',coalesce((select string_agg(p.oid::regprocedure::text,',') from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname='app_outside_search'),'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261031230000'
order by 1,2;
