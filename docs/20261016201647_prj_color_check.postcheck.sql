-- Works after apply (one record + validated constraint), dry-run/rollback (neither).
-- Compare precheck hashes (policies, grants, triggers, other constraints) and row count separately.
with history as (
  select count(*) as n,count(*) filter(where name='prj_color_check') as named
  from supabase_migrations.schema_migrations where version='20261016201647'
), con as (
  select count(*) as n,count(*) filter(where convalidated and contype='c'
    and pg_get_constraintdef(oid) like '%jsonb_typeof(metadata)%' and pg_get_constraintdef(oid) like '%"gray"%') as valid
  from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname='app_spaces_metadata_color_check'
)
select 'constraint and history agree' as item,case when (history.n=0 and con.n=0) or
  (history.n=1 and history.named=1 and con.n=1 and con.valid=1) then '예' else '아니오' end as ok from history,con
union all select 'rows with invalid color (=0)',count(*)::text from public.app_spaces where jsonb_typeof(metadata)='object' and metadata ? 'color'
  and metadata->'color' not in ('"green"'::jsonb,'"blue"'::jsonb,'"orange"'::jsonb,'"purple"'::jsonb,'"pink"'::jsonb,'"yellow"'::jsonb,'"red"'::jsonb,'"gray"'::jsonb)
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity) then '예' else '아니오' end;
