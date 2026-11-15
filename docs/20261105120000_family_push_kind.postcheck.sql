-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다.
-- expect: history row present = 예
-- expect: push log kind check with family = 예
-- expect: notify prefs check with family = 예
-- expect: push log rows = 기록
-- expect: push log and profiles grants policies hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261105120000' and name='family_push_kind')=1 then '예' else '아니오' end as value
union all select 'push log kind check with family',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_kind_check' and convalidated and pg_get_constraintdef(oid) ~ '''family''' and pg_get_constraintdef(oid) ~ '''quiet_digest''')=1 then '예' else '아니오' end
union all select 'notify prefs check with family',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_notify_prefs_check' and convalidated and pg_get_constraintdef(oid) ~ 'family' and pg_get_constraintdef(oid) ~ 'next_week')=1 then '예' else '아니오' end
union all select 'push log rows',(select count(*)::text from public.app_push_log)
union all select 'push log and profiles grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),''));
