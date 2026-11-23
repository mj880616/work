-- SELECT only. 20261123150000_update_news_auto 적용 뒤. 개수·참거짓만(소식 내용 없음).
-- 기대: 기록 1행, 새 칸 둘, 소식 표 RLS 켬·정책 없음·API 권한 없음, 함수 넷 DEFINER·빈 search_path, 자동 함수는 API 역할 실행 없음,
--   묶음 저장은 service_role만, 관리 목록·다시 보내기는 authenticated만, dev_inbox 허용 1행·소식 수는 사전 확인과 같음.
-- expect: history recorded = 예
-- expect: new columns present = 예
-- expect: news table locked = 예
-- expect: functions definer = 예
-- expect: auto helper closed = 예
-- expect: store server only = 예
-- expect: operator functions authenticated only = 예
-- expect: dev_inbox rows = 1
-- expect: news rows = 기록
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261123150000' and name='update_news_auto')=1 then '예' else '아니오' end as value
union all select 'new columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_update_news') and attname in ('auto','source_files') and attnotnull and not attisdropped)=2 then '예' else '아니오' end
union all select 'news table locked',case when exists(select 1 from pg_class c where c.oid=to_regclass('public.app_update_news') and c.relrowsecurity and not exists(select 1 from pg_policy p where p.polrelid=c.oid) and not has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger') and not has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'functions definer',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_update_news_auto(jsonb,jsonb)'),to_regprocedure('public.app_release_notes_put(jsonb,text)'),to_regprocedure('public.app_update_news_admin()'),to_regprocedure('public.app_update_news_resend(uuid)')) and prosecdef and proconfig=array['search_path=""'])=4 then '예' else '아니오' end
union all select 'auto helper closed',case when to_regprocedure('private.app_update_news_auto(jsonb,jsonb)') is not null and not has_function_privilege('anon','private.app_update_news_auto(jsonb,jsonb)','execute') and not has_function_privilege('authenticated','private.app_update_news_auto(jsonb,jsonb)','execute') and not has_function_privilege('service_role','private.app_update_news_auto(jsonb,jsonb)','execute') then '예' else '아니오' end
union all select 'store server only',case when has_function_privilege('service_role','public.app_release_notes_put(jsonb,text)','execute') and not has_function_privilege('anon','public.app_release_notes_put(jsonb,text)','execute') and not has_function_privilege('authenticated','public.app_release_notes_put(jsonb,text)','execute') then '예' else '아니오' end
union all select 'operator functions authenticated only',case when (select count(*) from pg_proc p where p.oid in(to_regprocedure('public.app_update_news_admin()'),to_regprocedure('public.app_update_news_resend(uuid)')) and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))=2 then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'news rows',(select count(*) from public.app_update_news)::text;
