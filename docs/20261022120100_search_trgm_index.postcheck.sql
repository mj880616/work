-- SELECT only. Works after apply (all 예) and after rollback (index and history absent → all 예 by absence).
with i as (
  select to_regclass('public.app_notes_search_trgm_idx') as idx
), history as (
  select count(*) filter(where name='search_trgm_index') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261022120100'
)
select 'index and history agree' as item,case when (history.n=0 and i.idx is null) or (history.n=1 and history.named=1 and i.idx is not null) then '예' else '아니오' end as ok
  from i,history
union all select 'index valid, gin trigram on app_notes',case when (select idx from i) is null or exists(select 1 from pg_index x join pg_class c on c.oid=x.indexrelid
  join pg_am a on a.oid=c.relam where x.indexrelid=(select idx from i) and x.indrelid=to_regclass('public.app_notes') and x.indisvalid and x.indisready and a.amname='gin'
  and pg_get_indexdef(x.indexrelid) like '%gin_trgm_ops%') then '예' else '아니오' end
union all select 'notes RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relrowsecurity) then '예' else '아니오' end
union all select 'pg_trgm still in extensions schema',case when exists(select 1 from pg_extension e join pg_namespace s on s.oid=e.extnamespace where e.extname='pg_trgm' and s.nspname='extensions') then '예' else '아니오' end;
