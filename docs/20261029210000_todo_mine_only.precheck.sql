-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). 카탈로그·기록만 읽는다(줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029210000') then '예' else '아니오' end as value
union all select 'workspaces and candidates tables',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_todo_candidates') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new objects absent',case when to_regclass('public.app_todo_ask_rooms') is null and to_regclass('public.app_todo_not_mine') is null and to_regprocedure('public.app_todo_ask_filter(uuid,text)') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
