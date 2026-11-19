-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 표·함수가 아직 없음과 이번 기록이 없음, 기존 경계(owner 함수·원장 검색·잠금 목록 함수의 정의·권한, 관련 표 권한·정책)를 기록한다(되돌린 뒤 같은지 대조).
-- authenticator 역할의 요청 전 설정 유무는 snapshot이 읽을 수 있는 카탈로그 밖이라 precheck·postcheck 항목으로 본다.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as definition
  from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('public.app_ledger_search(text,text[],uuid,uuid,date,date,text,text,boolean,integer)'),to_regprocedure('private.app_lock_note_folder_list(uuid)'))
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'),to_regclass('public.app_note_folder_locks'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'))
union all select 'mcp table',c.relname::text,'present'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'app\_mcp\_%'
union all select 'mcp function',p.oid::regprocedure::text,'present'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_mcp\_%'
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261120090000'
order by 1,2;
