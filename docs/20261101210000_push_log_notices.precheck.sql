-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / phone_push applied 예 / new columns absent 예 / status check present 예 / log boundary 예.
-- recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101210000') then '예' else '아니오' end as value
union all select 'phone_push applied',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261101010000') and to_regclass('public.app_push_log') is not null then '예' else '아니오' end
union all select 'new columns absent',case when to_regclass('public.app_push_log') is not null and not exists(select 1 from pg_attribute
  where attrelid=to_regclass('public.app_push_log') and not attisdropped and attname in ('shown_at','opened_at'))
  and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_shown_check') then '예' else '아니오' end
union all select 'status check present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_status_check') then '예' else '아니오' end
union all select 'log boundary',case when to_regclass('public.app_push_log') is not null
  and (select relrowsecurity from pg_class where oid=to_regclass('public.app_push_log'))
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_push_log'))=1
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_push_log') and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('authenticated','public.app_push_log','insert,update,delete') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
