-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / base migration present 예 / new columns absent 예 / one policy 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102160000') then '예' else '아니오' end as value
union all select 'base migration present',case when (select count(*) from supabase_migrations.schema_migrations where version='20261101040000' and name='phone_trash_log')=1 then '예' else '아니오' end
union all select 'new columns absent',case when to_regclass('public.app_phone_trash_log') is not null and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_phone_trash_log') and attname in ('keep','rel_path','taken_at') and not attisdropped) then '예' else '아니오' end
union all select 'one policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_phone_trash_log'))=1 then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
