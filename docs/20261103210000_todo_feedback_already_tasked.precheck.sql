-- SELECT only. Aggregates and hashes; no summary text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 결과 검사식에 already_tasked 없음 예 / 저장된 already_tasked 0 / RLS 예 / anon·service_role 권한 아니오 / 정책 1개 예.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: outcome check without already_tasked = 예
-- expect: saved already_tasked = 0
-- expect: RLS enabled = 예
-- expect: anon or service role privilege = 아니오
-- expect: one owner policy = 예
-- expect: feedback rows = 기록
-- expect: outcome check definition hash = 기록
-- expect: other constraints hash = 기록
-- expect: policies hash = 기록
-- expect: grants hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version in ('20261101180000','20261102030000'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261103210000') then '예' else '아니오' end
union all select 'outcome check without already_tasked',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_todo_feedback') and conname='app_todo_feedback_outcome_check' and contype='c' and convalidated and pg_get_constraintdef(oid) !~ 'already_tasked')=1 then '예' else '아니오' end
union all select 'saved already_tasked',count(*)::text from public.app_todo_feedback where outcome='already_tasked'
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_todo_feedback') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or service role privilege',case when has_table_privilege('anon','public.app_todo_feedback','select,insert,update,delete') or has_table_privilege('service_role','public.app_todo_feedback','select,insert,update,delete') then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_feedback'))=1 then '예' else '아니오' end
union all select 'feedback rows',count(*)::text from public.app_todo_feedback
union all select 'outcome check definition hash',md5(coalesce(string_agg(pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_todo_feedback') and conname='app_todo_feedback_outcome_check'
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_todo_feedback') and conname<>'app_todo_feedback_outcome_check'
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),'')) from pg_policy where polrelid=to_regclass('public.app_todo_feedback')
union all select 'grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_todo_feedback')),'')||coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_todo_feedback') and attnum>0 and not attisdropped),''));
