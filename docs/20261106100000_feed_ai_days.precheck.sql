-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(앱 표 행 수·행 값을 읽지 않음).
-- 적용 전 기대: 아래 다섯 항목 모두 예. recent migrations는 기록만.
-- expect: new migration absent = 예
-- expect: prerequisite migration = 예
-- expect: new table and topic column absent = 예
-- expect: owner check function and workspaces table = 예
-- expect: detail table grants as before = 예
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261106100000') then '예' else '아니오' end as value
union all select 'prerequisite migration',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261102140000' and name='now_detail') then '예' else '아니오' end
union all select 'new table and topic column absent',case when to_regclass('public.app_feed_ai_days') is null
  and to_regclass('public.app_now_details') is not null
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_now_details') and attname='topic' and not attisdropped)
  and not exists(select 1 from pg_constraint where conname='app_now_details_topic_check') then '예' else '아니오' end
union all select 'owner check function and workspaces table',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'detail table grants as before',case when to_regclass('public.app_now_details') is not null
  and has_table_privilege('authenticated','public.app_now_details','select')
  and not has_any_column_privilege('authenticated','public.app_now_details','insert,update')
  and not has_table_privilege('anon','public.app_now_details','select,insert,update,delete')
  and has_table_privilege('service_role','public.app_now_details','select,insert,update') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
