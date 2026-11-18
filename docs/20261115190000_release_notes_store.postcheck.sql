-- SELECT only. 20261115190000_release_notes_store 적용 뒤. 개수·참거짓만(기록 내용 없음).
-- 기대: 기록 1행, 새 표 RLS 켬·정책 없음·API 권한 없음, 두 함수 DEFINER·빈 search_path, 읽기는 authenticated만·쓰기는 service_role만, dev_inbox 허용 1행 그대로.
-- expect: history recorded = 예
-- expect: table locked = 예
-- expect: functions definer = 예
-- expect: read authenticated only = 예
-- expect: put service_role only = 예
-- expect: dev_inbox rows = 1
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115190000' and name='release_notes_store')=1 then '예' else '아니오' end as value
union all select 'table locked',case when to_regclass('public.app_release_notes') is not null and (select relrowsecurity from pg_class where oid=to_regclass('public.app_release_notes')) and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_release_notes')) and not has_table_privilege('anon','public.app_release_notes','select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('authenticated','public.app_release_notes','select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('service_role','public.app_release_notes','select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'functions definer',case when (select count(*) from pg_proc where oid in(to_regprocedure('public.app_release_notes_read()'),to_regprocedure('public.app_release_notes_put(jsonb,text)')) and prosecdef and proconfig=array['search_path=""'])=2 then '예' else '아니오' end
union all select 'read authenticated only',case when to_regprocedure('public.app_release_notes_read()') is not null and has_function_privilege('authenticated','public.app_release_notes_read()','execute') and not has_function_privilege('anon','public.app_release_notes_read()','execute') and not has_function_privilege('service_role','public.app_release_notes_read()','execute') then '예' else '아니오' end
union all select 'put service_role only',case when to_regprocedure('public.app_release_notes_put(jsonb,text)') is not null and has_function_privilege('service_role','public.app_release_notes_put(jsonb,text)','execute') and not has_function_privilege('anon','public.app_release_notes_put(jsonb,text)','execute') and not has_function_privilege('authenticated','public.app_release_notes_put(jsonb,text)','execute') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text;
