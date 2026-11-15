-- SELECT only. 20261116002500_signup_status 적용 뒤. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다.
-- expect: history row present = 예
-- expect: list function definer authenticated only = 예
-- expect: list returns new fields = 예
-- expect: helper functions unchanged = 예
-- expect: dev_inbox rows = 1
-- expect: profiles grants policies hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261116002500' and name='signup_status')=1 then '예' else '아니오' end as value
union all select 'list function definer authenticated only',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_signup_list()') and prosecdef and proconfig=array['search_path=""'] and prorettype='jsonb'::regtype)=1 and has_function_privilege('authenticated','public.app_signup_list()','execute') and not has_function_privilege('anon','public.app_signup_list()','execute') and not has_function_privilege('service_role','public.app_signup_list()','execute') then '예' else '아니오' end
union all select 'list returns new fields',case when (select pg_get_functiondef(oid) from pg_proc where oid=to_regprocedure('public.app_signup_list()')) ~ 'department_name' and (select pg_get_functiondef(oid) from pg_proc where oid=to_regprocedure('public.app_signup_list()')) ~ 'union_name' and (select pg_get_functiondef(oid) from pg_proc where oid=to_regprocedure('public.app_signup_list()')) ~ 'OPERATOR_FEATURE_REQUIRED' then '예' else '아니오' end
union all select 'helper functions unchanged',case when not has_function_privilege('anon','private.app_signup_people()','execute') and not has_function_privilege('authenticated','private.app_signup_people()','execute') and has_function_privilege('service_role','public.app_signup_since(timestamp with time zone)','execute') and not has_function_privilege('authenticated','public.app_signup_since(timestamp with time zone)','execute') and not has_function_privilege('anon','public.app_signup_since(timestamp with time zone)','execute') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'profiles grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_profiles')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_profiles')),''));
