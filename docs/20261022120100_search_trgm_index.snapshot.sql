-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- New index only: records the existing app_notes indexes, the pg_trgm extension schema/version, and that the new index is absent.
select 'index' as kind,indexname::text as name,md5(indexdef) as definition from pg_indexes where schemaname='public' and tablename='app_notes'
union all select 'search index','public.app_notes_search_trgm_idx',coalesce(to_regclass('public.app_notes_search_trgm_idx')::text,'absent')
union all select 'extension',e.extname::text,s.nspname::text||':'||e.extversion from pg_extension e join pg_namespace s on s.oid=e.extnamespace where e.extname='pg_trgm'
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261022120100'
order by 1,2;
