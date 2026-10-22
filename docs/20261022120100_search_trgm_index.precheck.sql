-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no row values.
-- 적용 전 기대: 아래 예/아니오 항목 모두 예. pg_trgm이 extensions 스키마에 없으면 '아니오' → 대시보드에서 먼저 켠다(별도 정지 지점).
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: recent migrations = 기록
-- expect: notes rows = 기록
-- expect: notes indexes hash = 기록
-- expect: notes rows hash = 기록
select 'search function migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261022120000' and name='search_records')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022120100') then '예' else '아니오' end
union all select 'pg_trgm in extensions schema',case when exists(select 1 from pg_extension e join pg_namespace s on s.oid=e.extnamespace where e.extname='pg_trgm' and s.nspname='extensions') then '예' else '아니오' end
union all select 'search index absent',case when to_regclass('public.app_notes_search_trgm_idx') is null then '예' else '아니오' end
union all select 'notes columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_notes') and not attisdropped and attname in('title','raw_text','attachments'))=3 then '예' else '아니오' end
union all select 'notes indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_notes'
union all select 'notes rows',(select count(*)::text from public.app_notes)
union all select 'notes rows hash',(select md5(coalesce(string_agg(n.id::text||':'||n.updated_at::text,',' order by n.id),'')) from public.app_notes n)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
