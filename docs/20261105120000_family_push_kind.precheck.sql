-- SELECT only. Run before dry-run/apply. 카탈로그·migration 기록·줄 수만 읽는다(알림 기록·설정 값 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: push log kind check without family = 예
-- expect: notify prefs check without family = 예
-- expect: push log rows = 기록
-- expect: push log and profiles grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261105120000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261101010000','phone_push'),('20261101210000','push_log_notices'),('20261105100000','family_notes')))=3 then '예' else '아니오' end
union all select 'push log kind check without family',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_kind_check' and pg_get_constraintdef(oid) ~ '''quiet_digest''' and pg_get_constraintdef(oid) !~ '''family''')=1 then '예' else '아니오' end
union all select 'notify prefs check without family',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_notify_prefs_check' and pg_get_constraintdef(oid) ~ 'next_week' and pg_get_constraintdef(oid) !~ 'family')=1 then '예' else '아니오' end
union all select 'push log rows',(select count(*)::text from public.app_push_log)
union all select 'push log and profiles grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),''));
