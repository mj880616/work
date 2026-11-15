-- SELECT only. 20261105183000_workspace_self_start 적용 뒤. 개수·참거짓·해시만 본다(행 내용·id 없음).
-- 기대: 기록 1행, 스위치 표는 RLS 켬·정책 없음·API 역할 권한 없음·꺼진 1행, 함수 둘은 DEFINER·빈 search_path·authenticated만 실행(PUBLIC·anon·service_role 없음).
--   owner 행·작업공간 수와 세 표의 정책·권한·트리거·인덱스 해시, 역할 트리거 정의 해시는 사전 확인과 같은 값(이 파일은 기존 것을 바꾸지 않고, 적용만으로는 작업공간이 생기지 않음).
-- expect: history recorded = 예
-- expect: switch table rls on = 예
-- expect: switch table no policies = 예
-- expect: switch table no api privilege = 예
-- expect: switch single row off = 예
-- expect: functions definer with empty search_path = 예
-- expect: authenticated can execute both = 예
-- expect: anon service_role public cannot execute = 예
-- expect: owner rows = 기록
-- expect: workspaces rows = 기록
-- expect: member role trigger count = 기록
-- expect: member role trigger function hash = 기록
-- expect: three tables policies hash = 기록
-- expect: three tables grants and RLS hash = 기록
-- expect: three tables triggers hash = 기록
-- expect: three tables indexes hash = 기록
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261105183000' and name='workspace_self_start')=1 then '예' else '아니오' end as value
union all select 'switch table rls on',case when exists(select 1 from pg_class where oid=to_regclass('public.app_workspace_signup') and relrowsecurity) then '예' else '아니오' end
union all select 'switch table no policies',case when to_regclass('public.app_workspace_signup') is not null and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_workspace_signup')) then '예' else '아니오' end
union all select 'switch table no api privilege',case when to_regclass('public.app_workspace_signup') is not null and not has_table_privilege('anon','public.app_workspace_signup','select,insert,update,delete') and not has_table_privilege('authenticated','public.app_workspace_signup','select,insert,update,delete') and not has_table_privilege('service_role','public.app_workspace_signup','select,insert,update,delete') then '예' else '아니오' end
union all select 'switch single row off',case when (select count(*) from public.app_workspace_signup)=1 and (select count(*) from public.app_workspace_signup where id=1 and not open)=1 then '예' else '아니오' end
union all select 'functions definer with empty search_path',case when (select count(*) from pg_proc where oid in(to_regprocedure('public.app_workspace_start()'),to_regprocedure('public.app_workspace_start_status()')) and prosecdef and proconfig=array['search_path=""'])=2 then '예' else '아니오' end
union all select 'authenticated can execute both',case when to_regprocedure('public.app_workspace_start()') is not null and to_regprocedure('public.app_workspace_start_status()') is not null and has_function_privilege('authenticated','public.app_workspace_start()','execute') and has_function_privilege('authenticated','public.app_workspace_start_status()','execute') then '예' else '아니오' end
union all select 'anon service_role public cannot execute',case when to_regprocedure('public.app_workspace_start()') is not null and to_regprocedure('public.app_workspace_start_status()') is not null
  and not has_function_privilege('anon','public.app_workspace_start()','execute') and not has_function_privilege('anon','public.app_workspace_start_status()','execute')
  and not has_function_privilege('service_role','public.app_workspace_start()','execute') and not has_function_privilege('service_role','public.app_workspace_start_status()','execute')
  and not exists(select 1 from pg_proc where oid in(to_regprocedure('public.app_workspace_start()'),to_regprocedure('public.app_workspace_start_status()')) and proacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'owner rows',(select count(*)::text from public.app_workspace_members where role='owner')
union all select 'workspaces rows',(select count(*)::text from public.app_workspaces)
union all select 'member role trigger count',(select count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_workspace_members') and tgname='trg_app_enforce_workspace_member_role' and not tgisinternal)
union all select 'member role trigger function hash',md5(coalesce((select string_agg(t.tgenabled::text||':'||md5(pg_get_functiondef(t.tgfoid)),',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_workspace_members') and t.tgname='trg_app_enforce_workspace_member_role' and not t.tgisinternal),''))
union all select 'three tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''))
union all select 'three tables grants and RLS hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''))
union all select 'three tables triggers hash',md5(coalesce((select string_agg(c.relname||':'||t.tgname::text||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)),',' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles')) and not t.tgisinternal),''))
union all select 'three tables indexes hash',md5(coalesce((select string_agg(md5(pg_get_indexdef(i.indexrelid)),',' order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''));
