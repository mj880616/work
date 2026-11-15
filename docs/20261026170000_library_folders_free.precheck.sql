-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no folder names, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: folder row count = 기록
-- expect: folder item row count = 기록
-- expect: folder items whose project differs from the folder = 기록
-- expect: folder items policy hash = 기록
-- expect: folder trigger functions hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026170000') then '예' else '아니오' end as value
union all select 'library_folders migration recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261022120000' and name='library_folders')=1 then '예' else '아니오' end
union all select 'folder tables present with RLS',case when (select count(*) from pg_class where oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items')) and relrowsecurity and not relforcerowsecurity)=2 then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'tree guard still has the same-project check',case when (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%f.project_id is not distinct from new.project_id%')=1 then '예' else '아니오' end
union all select 'lift still drops links of another project',case when (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_lift()') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%d.project_id is not distinct from old.project_id%')=1 then '예' else '아니오' end
union all select 'one items policy with the same-project check',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_library_folder_items') and polname='library_folder_items_owner_all' and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polwithcheck,polrelid) like '%d.project_id IS DISTINCT FROM f.project_id%')=1 then '예' else '아니오' end
union all select 'two folder triggers present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete'))=2 then '예' else '아니오' end
union all select 'folder row count',(select count(*)::text from public.app_library_folders)
union all select 'folder item row count',(select count(*)::text from public.app_library_folder_items)
union all select 'folder items whose project differs from the folder',(select count(*)::text from public.app_library_folder_items i join public.app_library_folders f on f.id=i.folder_id join public.app_documents d on d.id=i.document_id where d.project_id is distinct from f.project_id)
union all select 'folder items policy hash',(select coalesce(md5(string_agg(polname||pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' order by polname)),'none') from pg_policy where polrelid=to_regclass('public.app_library_folder_items'))
union all select 'folder trigger functions hash',(select md5(string_agg(p.oid::regprocedure::text||md5(p.prosrc),'|' order by p.oid::regprocedure::text)) from pg_proc p where p.oid in (to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('private.app_library_folder_lift()')))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
