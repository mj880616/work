-- SELECT only. 20261124070000_now_detail_body_key 적용 전(시험 적용 전후 비교에도 씀). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 기대: 앞 단계 둘 기록 있음, 이번 기록·새 칸 없음, 두 표 RLS 켜짐.
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: body_key absent = 예
-- expect: both tables RLS on = 예
-- expect: recent migrations = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261115140000' and name='news_for_all_refs') or (version='20261115150000' and name='outside_for_all'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261124070000') then '예' else '아니오' end
union all select 'body_key absent',case when not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details')) and attname='body_key' and not attisdropped) then '예' else '아니오' end
union all select 'both tables RLS on',case when (select count(*) from pg_class where oid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
