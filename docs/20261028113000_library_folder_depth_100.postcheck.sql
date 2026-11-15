-- SELECT only. Works after apply (all 예) and after rollback (all 예 by the 3 level shape). The shape that must hold follows the migration history row.
-- 숫자·해시 항목(폴더 수·휴지통 폴더 수·가장 깊은 단·실행권 해시)은 사전 확인의 같은 이름 항목과 같아야 한다(행·권한이 바뀌지 않음).
with history as (
  select count(*) filter(where name='library_folder_depth_100') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261028113000'
), shape as (
  select (history.n=1 and history.named=1) as applied, (history.n=0) as reverted from history
)
select 'history agrees with the function shapes' as item,case when
  (select applied from shape)
  and (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and prosrc like '%if v_above >= 100 then%' and prosrc like '%d.lvl < 101%' and prosrc like '%if v_above + v_height > 100 then%')=1
  and (select count(*) from pg_proc where oid=to_regprocedure('public.app_trash_restore(text,uuid)') and prosrc like '%up.lvl < 101%' and prosrc like '%d.lvl < 101%' and prosrc like '%if v_above + v_height > 100 then%')=1
  and (select count(*) from pg_proc where oid=to_regprocedure('private.app_trash_library_folder_before_delete()') and prosrc like '%array_length(t.path, 1) < 101%')=1
  or (select reverted from shape)
  and (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and prosrc like '%if v_above >= 3 then%' and prosrc like '%d.lvl < 4%')=1
  and (select count(*) from pg_proc where oid=to_regprocedure('public.app_trash_restore(text,uuid)') and prosrc like '%up.lvl < 6%' and prosrc like '%if v_above + v_height > 3 then%')=1
  and (select count(*) from pg_proc where oid=to_regprocedure('private.app_trash_library_folder_before_delete()') and prosrc like '%array_length(t.path, 1) < 10%')=1
  then '예' else '아니오' end as value
union all select 'cycle and workspace checks kept in the tree guard',case when (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_tree_guard()') and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%LIB_FOLDER_CYCLE%' and prosrc like '%LIB_FOLDER_SCOPE%' and prosrc like '%pg_advisory_xact_lock%' and prosrc not like '%project_id%')=1 then '예' else '아니오' end
union all select 'trigger functions have no execute grant',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('private.app_trash_library_folder_before_delete()')) and proconfig=array['search_path=""'] and proacl is not null and proacl::text !~ '(^|[{,])(anon|authenticated|service_role)?=')=2 then '예' else '아니오' end
union all select 'trash restore runs for authenticated only',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_trash_restore(text,uuid)') and prosecdef and proconfig=array['search_path=""'] and proacl::text ~ '(^|[{,])authenticated=X/' and proacl::text !~ '(^|[{,])(anon|service_role)?=')=1 then '예' else '아니오' end
union all select 'three folder triggers present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete','app_library_folders_a_trash_before_delete'))=3 then '예' else '아니오' end
union all select 'RLS enabled on both folder tables',case when (select count(*) from pg_class where oid in(to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'folder row count',(select count(*)::text from public.app_library_folders)
union all select 'folder rows in trash',(select count(*)::text from public.app_library_folders where deleted_at is not null)
union all select 'deepest folder level',(with recursive t(id,lvl) as (select f.id,1 from public.app_library_folders f where f.parent_id is null union all select f.id,t.lvl+1 from public.app_library_folders f join t on f.parent_id=t.id where t.lvl<101) select coalesce(max(lvl),0)::text from t)
union all select 'folder function acl hash',(select md5(string_agg(p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'none')||':'||p.prosecdef::text,'|' order by p.oid::regprocedure::text)) from pg_proc p where p.oid in (to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('private.app_trash_library_folder_before_delete()')));
