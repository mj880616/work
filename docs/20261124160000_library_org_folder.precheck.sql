-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: org columns, indexes and function absent = 예
-- expect: owner check function present = 예
-- expect: folders profiles organizations RLS on and no anon privilege = 예
-- expect: profiles table update for authenticated present = 예
-- expect: folders rows = 기록
-- expect: profiles rows = 기록
-- expect: folders profiles grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261124160000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261124100000' and name='library_folder_drive')=1 and (select count(*) from supabase_migrations.schema_migrations where version='20261111181000' and name='library_receive_folder')=1 then '예' else '아니오' end
union all select 'org columns, indexes and function absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_library_folders') and attname='organization_id' and not attisdropped) and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='org_files_folder' and not attisdropped) and to_regclass('public.app_library_folders_org_idx') is null and to_regclass('public.app_profiles_org_files_folder_idx') is null and to_regprocedure('public.app_library_folder_set_org(uuid,uuid)') is null then '예' else '아니오' end
union all select 'owner check function present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'folders profiles organizations RLS on and no anon privilege',case when (select count(*) from pg_class where oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'),to_regclass('public.app_suborganizations')) and relrowsecurity)=3 and not has_any_column_privilege('anon','public.app_library_folders','select,insert,update,references') and not has_any_column_privilege('anon','public.app_profiles','select,insert,update,references') then '예' else '아니오' end
union all select 'profiles table update for authenticated present',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then '예' else '아니오' end
union all select 'folders rows',(select count(*)::text from public.app_library_folders)
union all select 'profiles rows',(select count(*)::text from public.app_profiles)
union all select 'folders profiles grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles')) and not t.tgisinternal),''));
