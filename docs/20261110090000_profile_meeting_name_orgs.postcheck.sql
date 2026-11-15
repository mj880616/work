-- SELECT only. Works after apply (record + CHECK with orgs) and after rollback/dry-run (record absent + CHECK without orgs).
-- 해시·개수 항목은 precheck의 같은 이름 값과 같아야 한다(표 권한·정책·트리거·인덱스·다른 검사·행 수·저장된 정리 행 수 그대로).
-- 'sorts check definition hash'는 적용 뒤 달라지므로(검사를 다시 만듦) 여기서는 비교하지 않고 'check and history agree'로 본다.
with history as (
  select count(*) as n,count(*) filter(where name='profile_meeting_name_orgs') as named from supabase_migrations.schema_migrations where version='20261110090000'
), checks as (
  select count(*) as n,count(*) filter(where pg_get_constraintdef(oid) ~ 'orgs') as with_orgs from pg_constraint
  where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_meeting_name_sorts_check' and contype='c' and convalidated
)
select 'check and history agree' as item,case when checks.n=1 and (
  (history.n=0 and checks.with_orgs=0) or (history.n=1 and history.named=1 and checks.with_orgs=1)) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'sorts column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='meeting_name_sorts' and not attisdropped
union all select 'saved orgs',count(*)::text from public.app_profiles where meeting_name_sorts ? 'orgs'
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'saved sorts rows',count(*)::text from public.app_profiles where meeting_name_sorts <> '{}'::jsonb
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname<>'app_profiles_meeting_name_sorts_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
