-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: 앞 6개 모두 예. 후보 수·원장 행 수는 기록만.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: ledger candidates = 기록
-- expect: ledger records = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261021190000') then '예' else '아니오' end as value
union all select 'ledger schema applied (20261021082000)',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261021082000' and name='ledger_schema') then '예' else '아니오' end
union all select 'ledger import applied (20261021150000)',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261021150000' and name='ledger_import') then '예' else '아니오' end
union all select 'ledger tables present (10)',case when (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%' and relrowsecurity)=10 then '예' else '아니오' end
union all select 'no candidate function yet',case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('app_confirm_ledger_candidate','app_queue_ledger_candidates')) then '예' else '아니오' end
union all select 'owner check function (security definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'ledger candidates',(select count(*)::text from public.app_ledger_candidates)
union all select 'ledger records',(select count(*)::text from public.app_ledger_records)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
