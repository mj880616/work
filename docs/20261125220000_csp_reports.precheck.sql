-- SELECT only. 20261125220000_csp_reports 적용 전(시험 적용 전후 비교에도 씀). 참거짓·migration 기록만, 행 내용은 읽지 않는다.
-- 기대: 이번 기록·새 표·새 함수 없음.
-- expect: new migration absent = 예
-- expect: table and function absent = 예
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125220000') then '예' else '아니오' end as value
union all select 'table and function absent',case when to_regclass('public.app_csp_reports') is null and to_regprocedure('public.app_csp_report_add(jsonb)') is null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
