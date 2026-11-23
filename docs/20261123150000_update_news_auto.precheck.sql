-- SELECT only. 20261123150000_update_news_auto 적용 전(시험 적용 전후 비교에도 씀). 개수·참거짓·migration 기록만, 소식·기록 내용은 읽지 않는다.
-- 기대: 앞 단계 둘(release_notes_store·update_news) 기록 있음, 이번 기록·새 칸·새 함수 없음, 다시 정의할 두 함수가 저장소 원문 판, dev_inbox 허용 1행.
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: new columns and functions absent = 예
-- expect: replaced functions are repository versions = 예
-- expect: dev_inbox rows = 1
-- expect: news rows = 기록
-- expect: recent migrations = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261115190000' and name='release_notes_store') or (version='20261115200000' and name='update_news'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261123150000') then '예' else '아니오' end
union all select 'new columns and functions absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_update_news') and attname in ('auto','source_files') and not attisdropped) and to_regprocedure('private.app_update_news_auto(jsonb,jsonb)') is null and to_regprocedure('public.app_update_news_resend(uuid)') is null then '예' else '아니오' end
union all select 'replaced functions are repository versions',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_release_notes_put(jsonb,text)') and md5(prosrc)='e83753fbe9d1088cf171c6f32806e35d') and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_update_news_admin()') and md5(prosrc)='e56d58a037be4749c5047593761a6e2a') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'news rows',(select count(*) from public.app_update_news)::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
