-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog·migration 기록만 읽는다(앱 표 행 없음).
-- 적용 전 기대: 아래 항목 모두 예.
-- expect: new migration absent = 예
-- expect: new table absent = 예
-- expect: owner check function = 예
-- expect: workspaces table = 예
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261108070000') then '예' else '아니오' end as value
union all select 'new table absent',case when to_regclass('public.app_news_highlights') is null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end;
