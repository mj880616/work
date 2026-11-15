-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104211500') then '예' else '아니오' end as value
union all select 'org status rows migration recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261030234000' and name='org_status_rows')=1 then '예' else '아니오' end
union all select 'source tables with uuid columns',case when (select count(*) from pg_attribute where not attisdropped and attnum>0 and atttypid='uuid'::regtype and (
     (attrelid=to_regclass('public.app_suborganizations') and attname in ('id','workspace_id'))
  or (attrelid=to_regclass('public.app_suborganization_updates') and attname in ('id','organization_id'))
  or (attrelid=to_regclass('public.app_notes') and attname in ('id','workspace_id'))
  or (attrelid=to_regclass('public.app_org_status_rows') and attname in ('id','workspace_id'))))=8 and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new table and function absent',case when to_regclass('public.app_weekly_org_lines') is null and to_regprocedure('private.app_weekly_org_lines_guard()') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
