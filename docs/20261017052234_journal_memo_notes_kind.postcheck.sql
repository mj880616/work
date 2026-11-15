-- SELECT only. Works after apply (record + 3 columns + 6 new CHECKs + 2 indexes) and after rollback/dry-run (none of them).
-- Compare precheck hashes (policies, grants, other constraints, rows) separately.
with history as (
  select count(*) as n,count(*) filter(where name='journal_memo_notes_kind') as named
  from supabase_migrations.schema_migrations where version='20261017052234'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_notes') and attnum>0 and not attisdropped and attname in('kind','title','journal_day')
), con as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_notes') and contype='c' and convalidated
    and conname in('app_notes_kind_check','app_notes_title_check','app_notes_journal_day_check','app_notes_work_line_check','app_notes_diary_private_check')
), raw as (
  select count(*) filter(where pg_get_constraintdef(oid) like '%100000%') as kinded,count(*) as n from pg_constraint
  where conrelid=to_regclass('public.app_notes') and conname='app_notes_raw_text_check' and contype='c' and convalidated
), idx as (
  select count(*) as n from pg_indexes where schemaname='public' and tablename='app_notes' and indexname in('app_notes_journal_day_unique','app_notes_kind_occurred_idx')
)
select 'columns constraints indexes and history agree' as item,case when
  (history.n=0 and cols.n=0 and con.n=0 and raw.n=1 and raw.kinded=0 and idx.n=0)
  or (history.n=1 and history.named=1 and cols.n=3 and con.n=5 and raw.n=1 and raw.kinded=1 and idx.n=2) then '예' else '아니오' end as ok
  from history,cols,con,raw,idx
union all select 'all rows still basket',case when not exists(select 1 from public.app_notes n where coalesce(to_jsonb(n)->>'kind','basket')<>'basket'
  or to_jsonb(n)->>'title' is not null or to_jsonb(n)->>'journal_day' is not null) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relrowsecurity) then '예' else '아니오' end
union all select 'owner policy only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_notes') and polname='notes_owner_all' and polcmd='*' and polroles=array['authenticated'::regrole::oid]) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_notes','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'no triggers',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_notes') and not tgisinternal) then '예' else '아니오' end;
