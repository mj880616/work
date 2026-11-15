-- SELECT only. Works after apply (record + multi-line CHECK) and after rollback/dry-run (no record + one-line CHECK).
-- Compare precheck hashes (rows, columns, other constraints, indexes, grants, policies) separately: they must not change.
with history as (
  select count(*) as n,count(*) filter(where name='journal_work_lines') as named
  from supabase_migrations.schema_migrations where version='20261020051027'
), con as (
  select count(*) as n,count(*) filter(where pg_get_constraintdef(oid) like '%{150}%') as lines
  from pg_constraint where conrelid=to_regclass('public.app_notes') and conname='app_notes_work_line_check' and contype='c' and convalidated
)
select 'work line CHECK and history agree' as item,case when
  (history.n=0 and con.n=1 and con.lines=0) or (history.n=1 and history.named=1 and con.n=1 and con.lines=1) then '예' else '아니오' end as ok
  from history,con
union all select 'one-per-day index kept',case when exists(select 1 from pg_indexes where schemaname='public' and tablename='app_notes' and indexname='app_notes_journal_day_unique') then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relrowsecurity) then '예' else '아니오' end
union all select 'owner policy only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_notes') and polname='notes_owner_all' and polcmd='*' and polroles=array['authenticated'::regrole::oid]) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_notes','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'no triggers',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_notes') and not tgisinternal) then '예' else '아니오' end;
