-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: new migration absent 예 / task_due column absent 예 / task_due constraint absent 예 / previous step applied 예 /
--   candidates table 예 / status·task_id·due columns 예 / summary not updatable by authenticated 예 / one owner policy 예 / recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261027060000') then '예' else '아니오' end as value
union all select 'task_due column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_todo_candidates') and attname='task_due' and not attisdropped) then '예' else '아니오' end
union all select 'task_due constraint absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_todo_candidates') and conname='app_todo_candidates_task_due_check') then '예' else '아니오' end
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261021075034' and name='todo_radar_candidates')=1 then '예' else '아니오' end
union all select 'candidates table',case when to_regclass('public.app_todo_candidates') is not null then '예' else '아니오' end
union all select 'status task_id due columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_todo_candidates') and not attisdropped and ((attname in('status','task_id') and atttypid='text'::regtype) or (attname='due' and atttypid='date'::regtype)))=3 then '예' else '아니오' end
union all select 'summary not updatable by authenticated',case when to_regclass('public.app_todo_candidates') is not null and not has_column_privilege('authenticated',to_regclass('public.app_todo_candidates'),'summary','update') then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_candidates'))=1 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_candidates') and polname='todo_candidates_owner_all')=1 then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
