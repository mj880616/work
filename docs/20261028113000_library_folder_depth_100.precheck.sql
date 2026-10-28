-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no folder names, ids or row values. No information_schema.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- 승인형 DB workflow 기대값: 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: folder row count = 기록
-- expect: folder rows in trash = 기록
-- expect: deepest folder level = 기록
-- expect: folder function acl hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261028113000') then '예' else '아니오' end as value
union all select 'earlier folder steps recorded',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261025180000','trash_library_folder_db'),('20261026170000','library_folders_free'),('20261027050000','trash_share_pages_db')))=3 then '예' else '아니오' end
union all select 'tree guard has the 3 level shape',case when (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and not prosecdef and proconfig=array['search_path=""'] and prosrc not like '%project_id%' and prosrc like '%if v_above >= 3 then%' and prosrc like '%d.lvl < 4%' and prosrc like '%if v_above + v_height > 3 then%')=1 then '예' else '아니오' end
union all select 'trash restore has the 3 level shape',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_trash_restore(text,uuid)') and prosecdef and proconfig=array['search_path=""'] and prosrc like '%app_share_pages%' and prosrc like '%up.lvl < 6%' and prosrc like '%d.lvl < 6%' and prosrc like '%if v_above + v_height > 3 then%')=1 then '예' else '아니오' end
union all select 'trash before delete has the 10 level shape',case when (select count(*) from pg_proc where oid=to_regprocedure('private.app_trash_library_folder_before_delete()') and prosecdef and proconfig=array['search_path=""'] and prosrc like '%array_length(t.path, 1) < 10%')=1 then '예' else '아니오' end
union all select 'three folder triggers present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete','app_library_folders_a_trash_before_delete'))=3 then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'folder row count',(select count(*)::text from public.app_library_folders)
union all select 'folder rows in trash',(select count(*)::text from public.app_library_folders where deleted_at is not null)
union all select 'deepest folder level',(with recursive t(id,lvl) as (select f.id,1 from public.app_library_folders f where f.parent_id is null union all select f.id,t.lvl+1 from public.app_library_folders f join t on f.parent_id=t.id where t.lvl<101) select coalesce(max(lvl),0)::text from t)
union all select 'folder function acl hash',(select md5(string_agg(p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'none')||':'||p.prosecdef::text,'|' order by p.oid::regprocedure::text)) from pg_proc p where p.oid in (to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('private.app_trash_library_folder_before_delete()')))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
