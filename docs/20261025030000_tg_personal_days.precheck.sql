-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: new migration absent 예 / personal table absent 예 / owner check function 예 / workspaces table 예 / recent migrations는 기록만.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025030000') then '예' else '아니오' end as value
union all select 'personal table absent',case when to_regclass('public.app_tg_personal_days') is null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
