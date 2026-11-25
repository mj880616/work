-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog·migration 기록·종류별 개수만 읽는다.
-- 적용 전 기대: new migration absent 예 / prerequisite migration 예 / owner function 예 / new table absent 예 /
-- cost kind check without cap and reload 예 / cost month check 예 / cost rows only topup or bill 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125235000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261028160000' and name='ai_usage_costs')
  and to_regclass('public.app_workspaces') is not null and to_regclass('public.app_ai_cost_entries') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_ai_usage_events') is null then '예' else '아니오' end
union all select 'cost kind check without cap and reload',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_ai_cost_entries')
  and conname='app_ai_cost_entries_kind_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ '''topup''' and pg_get_constraintdef(oid) ~ '''bill'''
  and pg_get_constraintdef(oid) !~ '''cap''' and pg_get_constraintdef(oid) !~ '''reload''')=1 then '예' else '아니오' end
union all select 'cost month check',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_ai_cost_entries')
  and conname='app_ai_cost_entries_month_check' and contype='c' and convalidated)=1 then '예' else '아니오' end
union all select 'cost rows only topup or bill',case when not exists(select 1 from public.app_ai_cost_entries where kind not in ('topup','bill')) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
