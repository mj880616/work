-- SELECT only. Works after apply (record + column + three CHECKs) and after rollback/dry-run (original single links CHECK, no column).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger or index change; no row added or removed; saved link lists untouched).
with history as (
  select count(*) as n,count(*) filter(where name='profile_quick_link_groups') as named from supabase_migrations.schema_migrations where version='20261027170000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='quick_link_groups' and not attisdropped
), checks as (
  select count(*) filter(where convalidated) as valid,count(*) as n,
    count(*) filter(where conname='app_profiles_quick_links_check' and pg_get_constraintdef(oid) ~ 'a-z0-9') as wide_links
  from pg_constraint where conrelid=to_regclass('public.app_profiles')
    and conname in ('app_profiles_quick_links_check','app_profiles_quick_link_groups_check','app_profiles_quick_links_group_ref_check')
)
select 'column checks and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=1 and checks.valid=1 and checks.wide_links=0)
  or (history.n=1 and history.named=1 and cols.n=1 and checks.n=3 and checks.valid=3 and checks.wide_links=1) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every profile link groups empty (or no column)',case when not exists(select 1 from public.app_profiles p
  where to_jsonb(p) ? 'quick_link_groups' and to_jsonb(p)->'quick_link_groups' <> 'null'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'saved link lists',count(*)::text from public.app_profiles where quick_links is not null
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname not in ('app_profiles_quick_links_check','app_profiles_quick_link_groups_check','app_profiles_quick_links_group_ref_check')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped and attname<>'quick_link_groups'
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
