-- SELECT only. 20261115234500_signup_notify 적용 뒤. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다.
-- expect: history row present = 예
-- expect: push log kind check with signup = 예
-- expect: notify prefs check with signup = 예
-- expect: functions definer = 예
-- expect: people helper closed = 예
-- expect: list authenticated only = 예
-- expect: since service_role only = 예
-- expect: dev_inbox rows = 1
-- expect: push log rows = 기록
-- expect: push log and profiles grants policies hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115234500' and name='signup_notify')=1 then '예' else '아니오' end as value
union all select 'push log kind check with signup',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_kind_check' and convalidated and pg_get_constraintdef(oid) ~ '''signup''' and pg_get_constraintdef(oid) ~ '''family''')=1 then '예' else '아니오' end
union all select 'notify prefs check with signup',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_notify_prefs_check' and convalidated and pg_get_constraintdef(oid) ~ 'signup' and pg_get_constraintdef(oid) ~ 'family')=1 then '예' else '아니오' end
union all select 'functions definer',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_signup_people()'),to_regprocedure('public.app_signup_list()'),to_regprocedure('public.app_signup_since(timestamp with time zone)')) and prosecdef and proconfig=array['search_path=""'])=3 then '예' else '아니오' end
union all select 'people helper closed',case when to_regprocedure('private.app_signup_people()') is not null and not has_function_privilege('anon','private.app_signup_people()','execute') and not has_function_privilege('authenticated','private.app_signup_people()','execute') and not has_function_privilege('service_role','private.app_signup_people()','execute') then '예' else '아니오' end
union all select 'list authenticated only',case when to_regprocedure('public.app_signup_list()') is not null and has_function_privilege('authenticated','public.app_signup_list()','execute') and not has_function_privilege('anon','public.app_signup_list()','execute') and not has_function_privilege('service_role','public.app_signup_list()','execute') then '예' else '아니오' end
union all select 'since service_role only',case when to_regprocedure('public.app_signup_since(timestamp with time zone)') is not null and has_function_privilege('service_role','public.app_signup_since(timestamp with time zone)','execute') and not has_function_privilege('anon','public.app_signup_since(timestamp with time zone)','execute') and not has_function_privilege('authenticated','public.app_signup_since(timestamp with time zone)','execute') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'push log rows',(select count(*)::text from public.app_push_log)
union all select 'push log and profiles grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),''));
