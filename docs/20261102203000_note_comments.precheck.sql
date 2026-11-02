-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / notes table columns 예 / owner function 예 / new table absent 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102203000') then '예' else '아니오' end as value
union all select 'notes table columns',case when to_regclass('public.app_workspaces') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_notes') and attname='id' and atttypid='uuid'::regtype and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_notes') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_notes') and attname='kind' and atttypid='text'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_note_comments') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
