-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog·migration 기록·개수만 읽는다(행 값 없음).
-- 적용 전 기대: new migration absent 예 / prerequisite migrations 예 / owner helper 예 / cloud tables RLS on 예 /
-- read policies owner and files 예 / find function checks files 예. 작업공간별 색인 줄 수·허용 행 수·최근 기록은 기록만.
-- expect: cloud items workspaces = 기록
-- expect: files feature rows = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115120000') then '예' else '아니오' end as value
union all select 'prerequisite migrations',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261102160000' and name='cloud_files_index')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261104120000' and name='cloud_find_sources')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261104162800' and name='cloud_jobs') then '예' else '아니오' end
union all select 'owner helper',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'cloud tables RLS on',case when (select count(*) from pg_class where oid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),
  to_regclass('public.app_cloud_jobs')) and relrowsecurity)=3 then '예' else '아니오' end
union all select 'read policies owner and files',case when (select count(*) from pg_policy p where p.polrelid in (to_regclass('public.app_cloud_items'),
  to_regclass('public.app_cloud_stars'),to_regclass('public.app_cloud_jobs')))=3
  and (select count(*) from pg_policy p where p.polname in ('cloud_items_owner_read','cloud_stars_owner_read','cloud_jobs_owner_read')
   and p.polrelid in (to_regclass('public.app_cloud_items'),to_regclass('public.app_cloud_stars'),to_regclass('public.app_cloud_jobs'))
   and p.polcmd='r' and strpos(pg_get_expr(p.polqual,p.polrelid),'app_is_workspace_owner(workspace_id)')>0
   and strpos(pg_get_expr(p.polqual,p.polrelid),'''files''')>0)=3 then '예' else '아니오' end
union all select 'find function checks files',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')
  and prosecdef and strpos(pg_get_functiondef(oid),'app_workspace_has_feature(v_ws, ''files'')')>0)=1 then '예' else '아니오' end
union all select 'cloud items workspaces',(select count(distinct workspace_id) from public.app_cloud_items)::text
union all select 'files feature rows',(select count(*) from public.app_operator_features where feature='files')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
