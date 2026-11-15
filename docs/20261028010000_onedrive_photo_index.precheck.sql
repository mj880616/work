-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / 연결 표 migration 있음 예 / 연결 표 예 / 새 표 없음 예 / 새 칸 개수 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: new columns present = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261028010000') then '예' else '아니오' end as value
union all select 'connection migration applied',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261026140000') then '예' else '아니오' end
union all select 'connections table',case when to_regclass('public.app_onedrive_connections') is not null then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_onedrive_folders') is null and to_regclass('public.app_onedrive_photos') is null then '예' else '아니오' end
union all select 'new columns present',(select count(*) from pg_attribute where attrelid=to_regclass('public.app_onedrive_connections') and not attisdropped
  and attname in ('delta_link','next_link','index_done_at','synced_at','index_lock_until'))::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
