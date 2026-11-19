-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 표·함수가 아직 없음과 이번 기록이 없음, 기존 경계(작업공간·멤버·노트 폴더·PIN 잠금 표 권한·정책, owner 함수, 앞 단계 잠금 함수)를 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,c.relname::text as name,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') as definition
  from pg_class c where c.oid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_note_folders'),to_regclass('public.app_feature_locks'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p where p.polrelid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_note_folders'),to_regclass('public.app_feature_locks'))
union all select 'trigger',t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regproc::text
  from pg_trigger t where t.tgrelid=to_regclass('public.app_note_folders') and not t.tgisinternal
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in('public','private') and p.proname like 'app\_lock\_%' and p.proname not like 'app\_lock\_note\_folder%') or p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'folder lock table',c.relname::text,'present'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='app_note_folder_locks'
union all select 'folder lock function',p.oid::regprocedure::text,'present'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_lock\_note\_folder%'
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261119233000'
order by 1,2;
