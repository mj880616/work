-- SELECT only. 20261124080000_app_lock_whole_app 적용 뒤. 카탈로그·migration 기록·줄 수만 읽는다(행 값 없음).
-- 예/아니오 항목은 모두 예, 줄 수·해시는 precheck의 같은 이름 항목과 같은 값이어야 한다(표 권한·정책·고치지 않는 잠금 함수 무변경).
-- expect: history row present = 예
-- expect: features check has app = 예
-- expect: clean features helper closed = 예
-- expect: lock table still closed = 예
-- expect: lock rows = 기록
-- expect: existing boundary hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261124080000' and name='app_lock_whole_app')=1 then '예' else '아니오' end as ok
union all select 'features check has app',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_feature_locks') and conname='app_feature_locks_features_check' and pg_get_constraintdef(oid) like '%''app''%' and pg_get_constraintdef(oid) like '%telegram%')=1 then '예' else '아니오' end
union all select 'clean features helper closed',case when exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.app_lock_clean_features(text[])') and not p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_functiondef(p.oid) like '%''app''%' and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0)) then '예' else '아니오' end
union all select 'lock table still closed',case when exists(select 1 from pg_class c where c.oid=to_regclass('public.app_feature_locks') and c.relrowsecurity
    and not exists(select 1 from pg_policy p where p.polrelid=c.oid)
    and not has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger')
    and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger')
    and not has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'lock rows',(select count(*)::text from public.app_feature_locks)
union all select 'existing boundary hash',md5(coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_feature_locks'),to_regclass('public.app_note_folder_locks'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_feature_locks'),to_regclass('public.app_note_folder_locks'))),'')||coalesce((select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in('public','private') and p.proname like 'app\_lock\_%' and p.proname <> 'app_lock_clean_features') or p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')),''));
