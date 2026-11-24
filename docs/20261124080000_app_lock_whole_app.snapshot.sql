-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 고치는 두 곳(features 검사·목록 도우미)의 지금 정의와, 그대로 두는 경계(작업공간·멤버·잠금 표 권한·정책, 나머지 잠금 함수, owner 함수)를 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,c.relname::text as name,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') as definition
  from pg_class c where c.oid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_feature_locks'),to_regclass('public.app_note_folder_locks'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p where p.polrelid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_feature_locks'),to_regclass('public.app_note_folder_locks'))
union all select 'constraint',conname::text,pg_get_constraintdef(oid)
  from pg_constraint where conrelid=to_regclass('public.app_feature_locks')
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in('public','private') and p.proname like 'app\_lock\_%') or p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261124080000'
order by 1,2;
