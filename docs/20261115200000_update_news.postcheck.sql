-- SELECT only. 20261115200000_update_news 적용 뒤. 개수·참거짓만(소식 내용 없음).
-- 기대: 기록 1행, 새 표 셋 RLS 켬·정책 없음·API 권한 없음, 함수 일곱 DEFINER·빈 search_path, 공개 함수 여섯은 authenticated만, 판정 함수는 API 역할 실행 없음,
--   dev_inbox 허용 1행·owner 행 수는 사전 확인과 같음.
-- expect: history recorded = 예
-- expect: tables locked = 예
-- expect: functions definer = 예
-- expect: public functions authenticated only = 예
-- expect: operator helper closed = 예
-- expect: dev_inbox rows = 1
-- expect: owner rows = 기록
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115200000' and name='update_news')=1 then '예' else '아니오' end as value
union all select 'tables locked',case when (select count(*) from pg_class c where c.oid in (to_regclass('public.app_update_news'),to_regclass('public.app_update_news_start'),to_regclass('public.app_update_news_reads')) and c.relrowsecurity and not exists(select 1 from pg_policy p where p.polrelid=c.oid) and not has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger'))=3 then '예' else '아니오' end
union all select 'functions definer',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_update_news_operator()'),to_regprocedure('public.app_update_news_list()'),to_regprocedure('public.app_update_news_seen()'),to_regprocedure('public.app_update_news_admin()'),to_regprocedure('public.app_update_news_save(uuid,text,text[],text[])'),to_regprocedure('public.app_update_news_withdraw(uuid)'),to_regprocedure('public.app_update_news_set_start(date)')) and prosecdef and proconfig=array['search_path=""'])=7 then '예' else '아니오' end
union all select 'public functions authenticated only',case when (select count(*) from pg_proc p where p.oid in(to_regprocedure('public.app_update_news_list()'),to_regprocedure('public.app_update_news_seen()'),to_regprocedure('public.app_update_news_admin()'),to_regprocedure('public.app_update_news_save(uuid,text,text[],text[])'),to_regprocedure('public.app_update_news_withdraw(uuid)'),to_regprocedure('public.app_update_news_set_start(date)')) and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))=6 then '예' else '아니오' end
union all select 'operator helper closed',case when to_regprocedure('private.app_update_news_operator()') is not null and not has_function_privilege('authenticated','private.app_update_news_operator()','execute') and not has_function_privilege('anon','private.app_update_news_operator()','execute') and not has_function_privilege('service_role','private.app_update_news_operator()','execute') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'owner rows',(select count(*) from public.app_workspace_members where role='owner')::text;
