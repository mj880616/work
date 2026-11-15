-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: new migration absent 예 / new tables absent 예 / notify_prefs absent 예 / owner check function 예 / profiles boundary 예.
-- recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101010000') then '예' else '아니오' end as value
union all select 'new tables absent',case when to_regclass('public.app_push_devices') is null and to_regclass('public.app_push_log') is null then '예' else '아니오' end
union all select 'notify_prefs absent',case when not exists(select 1 from pg_attribute where attrelid='public.app_profiles'::regclass and not attisdropped and attname='notify_prefs')
  and not exists(select 1 from pg_constraint where connamespace='public'::regnamespace and conname='app_profiles_notify_prefs_check') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'profiles boundary',case when (select relrowsecurity from pg_class where oid='public.app_profiles'::regclass)
  and not exists(select 1 from pg_class where oid='public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
  and (select count(*) from pg_policy where polrelid='public.app_profiles'::regclass)=2 then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
