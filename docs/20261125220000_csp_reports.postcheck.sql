-- SELECT only. 20261125220000_csp_reports 적용 뒤. 개수·참거짓만(보고 내용 없음).
-- 기대: 기록 1행, 새 표 RLS 켬·정책 없음·API 권한 없음, 함수 DEFINER·빈 search_path·service_role만 실행.
-- expect: history recorded = 예
-- expect: table locked = 예
-- expect: function definer = 예
-- expect: add service_role only = 예
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261125220000' and name='csp_reports')=1 then '예' else '아니오' end as value
union all select 'table locked',case when to_regclass('public.app_csp_reports') is not null and (select relrowsecurity from pg_class where oid=to_regclass('public.app_csp_reports')) and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_csp_reports')) and not has_table_privilege('anon','public.app_csp_reports','select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('authenticated','public.app_csp_reports','select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('service_role','public.app_csp_reports','select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'function definer',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_csp_report_add(jsonb)') and prosecdef and proconfig=array['search_path=""'])=1 then '예' else '아니오' end
union all select 'add service_role only',case when to_regprocedure('public.app_csp_report_add(jsonb)') is not null and has_function_privilege('service_role','public.app_csp_report_add(jsonb)','execute') and not has_function_privilege('anon','public.app_csp_report_add(jsonb)','execute') and not has_function_privilege('authenticated','public.app_csp_report_add(jsonb)','execute') then '예' else '아니오' end;
