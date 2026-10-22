-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: new migration absent 예 / share media table absent 예 / share pages table 예 / owner check function 예 / recent migrations는 기록만.
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023110000') then '예' else '아니오' end as value
union all select 'share media table absent',case when to_regclass('public.app_share_page_media') is null then '예' else '아니오' end
union all select 'share pages table',case when to_regclass('public.app_share_pages') is not null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
