-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / organizations table with workspace 예 / owner function 예 / new tables and function absent 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029014700') then '예' else '아니오' end as value
union all select 'organizations table with workspace',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped) and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new tables and function absent',case when to_regclass('public.app_org_key_people') is null and to_regclass('public.app_org_key_people_briefs') is null and to_regprocedure('private.app_org_key_people_guard()') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
