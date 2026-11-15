-- SELECT only. Works after apply (record + checks accepting photo_sources and phone) and after rollback/dry-run (no record + checks without them).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger or index change; no row added or removed).
with history as (
  select count(*) as n,count(*) filter(where name='photo_sources') as named from supabase_migrations.schema_migrations where version='20261030230000'
), checks as (
  select count(*) filter(where c.convalidated and c.conname='app_profiles_view_prefs_check') as prefs_valid,
    count(*) filter(where c.conname='app_profiles_view_prefs_check' and pg_get_constraintdef(c.oid) ~ 'photo_hint') as prefs_hint,
    count(*) filter(where c.conname='app_profiles_view_prefs_check' and pg_get_constraintdef(c.oid) ~ 'photo_sources') as prefs_new,
    count(*) filter(where c.convalidated and c.conname in ('app_diary_stars_source_check','app_photo_tag_items_source_check')) as src_valid,
    count(*) filter(where c.conname in ('app_diary_stars_source_check','app_photo_tag_items_source_check') and pg_get_constraintdef(c.oid) ~ 'phone') as src_new
  from pg_constraint c where (c.conrelid=to_regclass('public.app_profiles') and c.conname='app_profiles_view_prefs_check')
    or (c.conrelid=to_regclass('public.app_diary_stars') and c.conname='app_diary_stars_source_check')
    or (c.conrelid=to_regclass('public.app_photo_tag_items') and c.conname='app_photo_tag_items_source_check')
)
select 'checks and history agree' as item,case when checks.prefs_valid=1 and checks.prefs_hint=1 and checks.src_valid=2 and (
  (history.n=0 and checks.prefs_new=0 and checks.src_new=0) or (history.n=1 and history.named=1 and checks.prefs_new=1 and checks.src_new=2)) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and relrowsecurity)=3 then '예' else '아니오' end
union all select 'policy counts',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_diary_stars'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_photo_tag_items'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_diary_stars','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_photo_tag_items','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'other constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),'')) from pg_constraint where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and conname not in ('app_profiles_view_prefs_check','app_diary_stars_source_check','app_photo_tag_items_source_check')
union all select 'indexes hash',md5(coalesce(string_agg(tablename||'.'||indexname||':'||indexdef,',' order by tablename,indexname),'')) from pg_indexes where schemaname='public' and tablename in ('app_profiles','app_diary_stars','app_photo_tag_items')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items'))
union all select 'column grants hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||coalesce(attacl::text,''),',' order by attrelid::regclass::text,attname),'')) from pg_attribute where attrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items'))
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),'')) from pg_trigger where tgrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and not tgisinternal
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'stars rows',count(*)::text from public.app_diary_stars
union all select 'album item rows',count(*)::text from public.app_photo_tag_items;
