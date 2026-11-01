-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). 카탈로그·기록만 읽는다(줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101180000') then '예' else '아니오' end as value
union all select 'candidates and task_due migrations applied',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261021075034' and name='todo_radar_candidates') or (version='20261027060000' and name='todo_candidates_task_due'))=2 then '예' else '아니오' end
union all select 'workspaces and candidates tables',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_todo_candidates') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'status check has 3 states only',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_todo_candidates') and conname='app_todo_candidates_status_check' and pg_get_constraintdef(oid) like '%dismissed%' and pg_get_constraintdef(oid) not like '%done%')=1 then '예' else '아니오' end
union all select 'candidates table has 1 policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_candidates'))=1 then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_todo_feedback') is null and to_regclass('public.app_todo_rules') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
