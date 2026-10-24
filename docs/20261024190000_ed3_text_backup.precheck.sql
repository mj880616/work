-- SELECT only. Run before dry-run/apply (also the dry-run before/after comparison). Counts only; no note, record or organization text.
-- 적용 전 기대: new migration absent 예 / backup table absent 예 / format columns migration 예 / three doc columns 예 /
--   no formatted rows yet 예 / owner check function 예 / every record has its organization or project 예.
-- 행 수는 기록만(사후 확인에서 백업 행 수와 같아야 한다).
-- expect: recent migrations = 기록
-- expect: note rows = 기록
-- expect: basket rows = 기록
-- expect: diary rows = 기록
-- expect: org update rows = 기록
-- expect: project record rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024190000') then '예' else '아니오' end as value
union all select 'backup table absent',case when to_regclass('public.app_ed3_text_backups') is null then '예' else '아니오' end
union all select 'format columns migration',case when (select count(*) from supabase_migrations.schema_migrations where version='20261023233000' and name='ed_format_columns')=1 then '예' else '아니오' end
union all select 'three doc columns',case when (select count(*) from pg_attribute where attname='doc' and not attisdropped and atttypid='jsonb'::regtype
  and attrelid in (to_regclass('public.app_notes'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_project_progress_updates')))=3 then '예' else '아니오' end
union all select 'no formatted rows yet',case when not exists(select 1 from public.app_notes n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb)
  and not exists(select 1 from public.app_suborganization_updates n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb)
  and not exists(select 1 from public.app_project_progress_updates n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb) then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'every record has its organization or project',case when not exists(select 1 from public.app_suborganization_updates u where not exists(select 1 from public.app_suborganizations o where o.id=u.organization_id))
  and not exists(select 1 from public.app_project_progress_updates p where not exists(select 1 from public.app_spaces s where s.id=p.project_id)) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'note rows',count(*)::text from public.app_notes where kind='note'
union all select 'basket rows',count(*)::text from public.app_notes where kind='basket'
union all select 'diary rows',count(*)::text from public.app_notes where kind='diary'
union all select 'org update rows',count(*)::text from public.app_suborganization_updates
union all select 'project record rows',count(*)::text from public.app_project_progress_updates;
