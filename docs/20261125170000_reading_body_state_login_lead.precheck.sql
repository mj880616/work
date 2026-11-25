-- SELECT only. 20261125170000_reading_body_state_login_lead 적용 전(시험 적용 전후 비교에도 씀). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 기대: 앞 단계 둘 기록 있음, 이번 기록 없음, 두 검사가 옛 모양(lead·login 없음), RLS 켜짐.
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: old body_state check = 예
-- expect: old body check = 예
-- expect: RLS on = 예
-- expect: recent migrations = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261122100000' and name='reading_items') or (version='20261122230000' and name='reading_one_store'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125170000') then '예' else '아니오' end
union all select 'old body_state check',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_reading_items') and conname='app_reading_items_body_state_check' and contype='c' and convalidated and pg_get_constraintdef(oid) ~ 'paywall' and pg_get_constraintdef(oid) !~ '''lead''' and pg_get_constraintdef(oid) !~ '''login''')=1 then '예' else '아니오' end
union all select 'old body check',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_reading_items') and conname='app_reading_items_body_check' and contype='c' and convalidated and pg_get_constraintdef(oid) ~ '200000' and pg_get_constraintdef(oid) !~ '''lead''')=1 then '예' else '아니오' end
union all select 'RLS on',case when (select relrowsecurity from pg_class where oid=to_regclass('public.app_reading_items')) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
