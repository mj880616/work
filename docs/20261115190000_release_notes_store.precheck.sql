-- SELECT only. 20261115190000_release_notes_store 적용 전(시험 적용 전후 비교에도 씀). 개수·참거짓·migration 기록만, 행 내용·id는 읽지 않는다.
-- 기대: 앞 단계(dev_inbox_feature) 기록 있음, 이번 기록·새 표·새 함수 없음, 운영자 판정 함수 있음, dev_inbox 허용 1행.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: table and functions absent = 예
-- expect: feature helper present = 예
-- expect: dev_inbox rows = 1
-- expect: recent migrations = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261103100000' and name='dev_inbox_feature')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115190000') then '예' else '아니오' end
union all select 'table and functions absent',case when to_regclass('public.app_release_notes') is null and to_regprocedure('public.app_release_notes_read()') is null and to_regprocedure('public.app_release_notes_put(jsonb,text)') is null then '예' else '아니오' end
union all select 'feature helper present',case when to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
