-- SELECT only. 20261118100000_collab_groups 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록만 읽는다(행 값 없음).
-- 기대: 예/아니오 항목은 모두 예. 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(기존 owner 경계가 그대로라는 뜻).
-- expect: new migration absent = 예
-- expect: profile step applied = 예
-- expect: prerequisite columns present = 예
-- expect: owner function definer = 예
-- expect: collab objects absent = 예
-- expect: existing owner boundary hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261118100000') then '예' else '아니오' end as value
union all select 'profile step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261115223000' and name='profile_union_department')=1 then '예' else '아니오' end
union all select 'prerequisite columns present',case when to_regclass('public.app_workspaces') is not null and (select count(*) from pg_attribute a where not a.attisdropped and ((a.attrelid=to_regclass('public.app_workspace_members') and a.attname in('workspace_id','user_id','role')) or (a.attrelid=to_regclass('public.app_profiles') and a.attname in('user_id','display_name','job_title'))))=6 then '예' else '아니오' end
union all select 'owner function definer',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'collab objects absent',case when not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'app\_collab\_%') and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_collab\_%') then '예' else '아니오' end
union all select 'existing owner boundary hash',md5(coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'),to_regclass('public.app_workspaces'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'),to_regclass('public.app_workspaces'))),'')||coalesce((select md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')),''));
