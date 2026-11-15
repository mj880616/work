-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: new migration absent 예 / 두 표 없음 예 / 작업공간 표 예 / 소유자 확인 함수 예 / 새 표 개수 0. recent migrations는 기록만.
-- expect: recent migrations = 기록
-- expect: new tables present = 0
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026140000') then '예' else '아니오' end as value
union all select 'new tables absent',case when to_regclass('public.app_onedrive_connections') is null and to_regclass('public.app_diary_stars') is null then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new tables present',(select count(*) from (values (to_regclass('public.app_onedrive_connections')),(to_regclass('public.app_diary_stars'))) v(r) where r is not null)::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
