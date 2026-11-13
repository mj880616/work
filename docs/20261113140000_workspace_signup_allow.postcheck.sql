-- SELECT only. 20261113140000_workspace_signup_allow 적용 뒤. 개수·참거짓·해시만(메일·행 내용 없음).
-- 기대: 기록 1행, 명단 표 RLS 켬·정책 없음·API 권한 없음, 운영자 1행·self_start 0행, 역할 트리거 함수에 메일 글자 없음, 스위치 꺼짐,
--   함수 둘 DEFINER·빈 search_path·authenticated만 실행. owner 행·작업공간 수·구성원 정책·트리거 해시는 사전 확인과 같은 값.
-- expect: history recorded = 예
-- expect: allow table locked = 예
-- expect: one operator no self start = 예
-- expect: role trigger has no fixed email = 예
-- expect: switch off = 예
-- expect: functions definer authenticated only = 예
-- expect: owner rows = 기록
-- expect: workspaces rows = 기록
-- expect: members policies hash = 기록
-- expect: members triggers hash = 기록
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261113140000' and name='workspace_signup_allow')=1 then '예' else '아니오' end as value
union all select 'allow table locked',case when to_regclass('public.app_workspace_signup_allow') is not null and (select relrowsecurity from pg_class where oid=to_regclass('public.app_workspace_signup_allow')) and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_workspace_signup_allow')) and not has_table_privilege('anon','public.app_workspace_signup_allow','select,insert,update,delete') and not has_table_privilege('authenticated','public.app_workspace_signup_allow','select,insert,update,delete') and not has_table_privilege('service_role','public.app_workspace_signup_allow','select,insert,update,delete') then '예' else '아니오' end
union all select 'one operator no self start',case when to_regclass('public.app_workspace_signup_allow') is not null and (select count(*) from public.app_workspace_signup_allow where kind='operator')=1 and (select count(*) from public.app_workspace_signup_allow where kind='self_start')=0 then '예' else '아니오' end
union all select 'role trigger has no fixed email',case when pg_get_functiondef('private.app_enforce_workspace_member_role()'::regprocedure) !~ '@' then '예' else '아니오' end
union all select 'switch off',case when (select count(*) from public.app_workspace_signup where id=1 and not open)=1 then '예' else '아니오' end
union all select 'functions definer authenticated only',case when (select count(*) from pg_proc where oid in(to_regprocedure('public.app_workspace_start()'),to_regprocedure('public.app_workspace_start_status()')) and prosecdef and proconfig=array['search_path=""'])=2 and has_function_privilege('authenticated','public.app_workspace_start()','execute') and has_function_privilege('authenticated','public.app_workspace_start_status()','execute') and not has_function_privilege('anon','public.app_workspace_start()','execute') and not has_function_privilege('anon','public.app_workspace_start_status()','execute') and not has_function_privilege('service_role','public.app_workspace_start()','execute') then '예' else '아니오' end
union all select 'owner rows',(select count(*)::text from public.app_workspace_members where role='owner')
union all select 'workspaces rows',(select count(*)::text from public.app_workspaces)
union all select 'members policies hash',md5(coalesce((select string_agg(p.polname::text||':'||p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_workspace_members')),''))
union all select 'members triggers hash',md5(coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)),',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_workspace_members') and not t.tgisinternal),''));
