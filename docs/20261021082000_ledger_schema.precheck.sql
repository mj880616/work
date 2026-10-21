-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: 앞 9개 모두 예. recent migrations·workspace count·owner count는 기록만(owner count는 1이어야 이전 계획이 맞음).
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261021082000') then '예' else '아니오' end as value
union all select 'no app_ledger table yet',case when not exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname like 'app\_ledger\_%') then '예' else '아니오' end
union all select 'no app_ledger function yet',case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_ledger\_%') then '예' else '아니오' end
union all select 'owner check function (security definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'spaces table',case when to_regclass('public.app_spaces') is not null then '예' else '아니오' end
union all select 'suborganizations table',case when to_regclass('public.app_suborganizations') is not null then '예' else '아니오' end
union all select 'meetings table',case when to_regclass('public.app_meetings') is not null then '예' else '아니오' end
union all select 'PostgreSQL 15 or newer (unique nulls not distinct)',case when current_setting('server_version_num')::int>=150000 then '예' else '아니오' end
union all select 'workspace count',count(*)::text from public.app_workspaces
union all select 'owner member count',count(*)::text from public.app_workspace_members where role='owner'
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
