-- SELECT only. Run before dry-run/apply. Aggregates only; no row values.
-- 적용 전 기대: 새 migration 기록 없음, 새 표 3개 없음, 작업공간 표·소유자 확인 함수·auth.users 있음, 최근 migration은 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026090000') then '예' else '아니오' end as value
union all select 'three new tables absent',case when to_regclass('public.app_onedrive_connections') is null and to_regclass('public.app_onedrive_photos') is null and to_regclass('public.app_diary_photo_stars') is null then '예' else '아니오' end
union all select 'workspaces table and auth users table',case when to_regclass('public.app_workspaces') is not null and to_regclass('auth.users') is not null then '예' else '아니오' end
union all select 'owner check function (definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
