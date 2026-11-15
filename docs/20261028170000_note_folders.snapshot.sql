-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 표·함수가 아직 없음과 이번 기록이 없음을 기록한다(되돌린 뒤 같은지 대조). 기존 표(app_notes)는 바꾸지 않으므로 정의를 읽지 않는다.
select 'table' as kind,'public.app_note_folders' as name,coalesce(to_regclass('public.app_note_folders')::text,'absent') as definition
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_note_folder_tree_guard()','private.app_note_folder_lift()']) n
union all select 'owner function',p.oid::regprocedure::text,p.prosecdef::text
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261028170000'
order by 1,2;
