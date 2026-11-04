-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / previous migration present 예 / table present 예 / end_day column absent 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104201500') then '예' else '아니오' end as value
union all select 'previous migration present',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261030234000' and name='org_status_rows') then '예' else '아니오' end
union all select 'table present',case when to_regclass('public.app_org_status_rows') is not null then '예' else '아니오' end
union all select 'end_day column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_org_status_rows') and attname='end_day' and not attisdropped) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
