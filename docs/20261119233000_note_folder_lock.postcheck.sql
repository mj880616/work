-- SELECT only. 20261119233000_note_folder_lock 적용 뒤. 카탈로그·migration 기록·줄 수만 읽는다(행 값 없음).
-- 예/아니오 항목은 모두 예, 줄 수·해시는 precheck의 같은 이름 항목과 같은 값이어야 한다(기존 경계·앞 단계 잠금 함수 무변경).
-- expect: history row present = 예
-- expect: folder lock table RLS on no policies no API privileges = 예
-- expect: two public functions definer empty path authenticated only = 예
-- expect: folder lock rows zero = 예
-- expect: note folders rows = 기록
-- expect: existing boundary hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261119233000' and name='note_folder_lock')=1 then '예' else '아니오' end as ok
union all select 'folder lock table RLS on no policies no API privileges',case when exists(select 1 from pg_class c where c.oid=to_regclass('public.app_note_folder_locks') and c.relrowsecurity
    and not exists(select 1 from pg_policy p where p.polrelid=c.oid)
    and not has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger')
    and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger')
    and not has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger')
    and not has_any_column_privilege('anon',c.oid,'select,insert,update,references')
    and not has_any_column_privilege('authenticated',c.oid,'select,insert,update,references')
    and not has_any_column_privilege('service_role',c.oid,'select,insert,update,references')
    and coalesce(c.relacl::text,'') !~ '(^|[{,])(anon|authenticated|service_role)?=') then '예' else '아니오' end
union all select 'two public functions definer empty path authenticated only',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_lock\_note\_folder%')=3
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app\_lock\_note\_folder%'
    and p.prosecdef and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0))=2 then '예' else '아니오' end
union all select 'folder lock rows zero',case when (select count(*) from public.app_note_folder_locks)=0 then '예' else '아니오' end
union all select 'note folders rows',(select count(*)::text from public.app_note_folders)
union all select 'existing boundary hash',md5(coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_note_folders'),to_regclass('public.app_feature_locks'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_note_folders'),to_regclass('public.app_feature_locks'))),'')||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_note_folders') and not t.tgisinternal),'')||coalesce((select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in('public','private') and p.proname like 'app\_lock\_%' and p.proname not like 'app\_lock\_note\_folder%') or p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')),''));
