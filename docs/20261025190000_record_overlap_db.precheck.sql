-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no row values.
-- 적용 전 기대: new migration absent 예 / overlaps table absent 예 / set function absent 예 / guard function absent 예 / owner check function 예 /
--   workspaces table 예 / source tables and columns present 예 / recent migrations는 기록만.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025190000') then '예' else '아니오' end as value
union all select 'overlaps table absent',case when to_regclass('public.app_record_overlaps') is null then '예' else '아니오' end
union all select 'set function absent',case when to_regprocedure('public.app_record_overlap_set(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'guard function absent',case when to_regprocedure('private.app_record_overlap_guard()') is null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'workspaces table',case when to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'source tables and columns present',case when (select count(*) from pg_attribute where not attisdropped and attnum>0 and (
    (attrelid=to_regclass('public.app_meetings') and attname in ('id','workspace_id'))
    or (attrelid=to_regclass('public.app_notes') and attname in ('id','workspace_id','kind'))
    or (attrelid=to_regclass('public.app_spaces') and attname in ('id','workspace_id'))
    or (attrelid=to_regclass('public.app_suborganizations') and attname in ('id','workspace_id'))
    or (attrelid=to_regclass('public.app_project_progress_updates') and attname in ('id','project_id'))
    or (attrelid=to_regclass('public.app_suborganization_updates') and attname in ('id','organization_id'))
    or (attrelid=to_regclass('public.app_record_links') and attname in ('workspace_id','note_id','meeting_id'))))=16 then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
