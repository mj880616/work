-- SELECT only. Aggregates and hashes; no profile text or calendar ids. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 참고 캘린더 검사에 mine 있고 org 없음 예 / 저장된 조직 0 /
--   RLS 예 / anon 아니오 / 정책 2개 예. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. pg_constraint·pg_get_constraintdef로 읽는다(information_schema 안 씀).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: ledger calendar check without org = 예
-- expect: saved org = 0
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: two owner policies = 예
-- expect: profiles rows = 기록
-- expect: profiles with a calendar = 기록
-- expect: ledger calendar check definition hash = 기록
-- expect: other constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261025110000' and name='ledger_sources')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261030210000') then '예' else '아니오' end
union all select 'ledger calendar check without org',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_ledger_calendar_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'mine' and pg_get_constraintdef(oid) !~ '"org"')=1 then '예' else '아니오' end
union all select 'saved org',count(*)::text from public.app_profiles where ledger_calendar ? 'org'
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[])
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'ledger calendar check definition hash',md5(coalesce(string_agg(pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_ledger_calendar_check'
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'profiles with a calendar',count(*)::text from public.app_profiles where ledger_calendar ? 'calendar'
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname<>'app_profiles_ledger_calendar_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
