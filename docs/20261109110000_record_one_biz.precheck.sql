-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261109110000') then '예' else '아니오' end as value
union all select 'previous migration record_one_org present',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261109100000' and name='record_one_org')
  and to_regclass('public.app_report_line_marks') is not null then '예' else '아니오' end
union all select 'prerequisite tables with workspace',case when to_regclass('public.app_workspaces') is not null
  and (select count(*) from pg_attribute where attnum>0 and not attisdropped and atttypid='uuid'::regtype and attname='workspace_id'
    and attrelid in (to_regclass('public.app_spaces'),to_regclass('public.app_feed_items'),to_regclass('public.app_journal_memorable'),to_regclass('public.app_notes')))=4 then '예' else '아니오' end
union all select 'owner and space functions',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is not null then '예' else '아니오' end
union all select 'new tables and functions absent',case when to_regclass('public.app_business_records') is null and to_regclass('public.app_business_now') is null
  and to_regprocedure('private.app_business_records_guard()') is null and to_regprocedure('private.app_business_now_guard()') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
