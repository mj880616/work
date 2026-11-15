-- SELECT only. 20261115210000_feedback 적용 전(시험 적용 전후 비교에도 씀). 개수·참거짓·migration 기록만, 행 내용·id는 읽지 않는다.
-- 기대: 앞 단계(dev_inbox_feature) 기록 있음, 이번 기록·새 표·새 함수 없음, 프로필 표·운영자 판정 함수 있음, dev_inbox 허용 1행.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: tables and functions absent = 예
-- expect: profiles and feature helper present = 예
-- expect: dev_inbox rows = 1
-- expect: recent migrations = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261103100000' and name='dev_inbox_feature')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115210000') then '예' else '아니오' end
union all select 'tables and functions absent',case when to_regclass('public.app_feedback') is null and to_regclass('public.app_feedback_photos') is null and to_regprocedure('public.app_feedback_send(text,jsonb,jsonb)') is null and to_regprocedure('private.app_feedback_operator()') is null then '예' else '아니오' end
union all select 'profiles and feature helper present',case when to_regclass('public.app_profiles') is not null and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
