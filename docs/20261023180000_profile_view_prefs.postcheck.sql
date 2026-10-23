-- SELECT only. Works after apply (record + column + CHECK) and after rollback/dry-run (none of them).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger or index change; no row added or removed).
with history as (
  select count(*) as n,count(*) filter(where name='profile_view_prefs') as named from supabase_migrations.schema_migrations where version='20261023180000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='view_prefs' and not attisdropped
), checks as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and convalidated
)
select 'column check and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0)
  or (history.n=1 and history.named=1 and cols.n=1 and checks.n=1) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every profile library view empty (or no column)',case when not exists(select 1 from public.app_profiles p
  where to_jsonb(p) ? 'view_prefs' and to_jsonb(p)->'view_prefs' <> 'null'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
