-- SELECT only. Works after apply (record + nine-kind check) and after rollback/dry-run (no record + the eight-kind original).
-- The hash/count items must equal the precheck values of the same name (no grant, column, policy, trigger or index change; no row added or removed).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
with history as (
  select count(*) as n,count(*) filter(where name='bizreport_oneline_kind') as named from supabase_migrations.schema_migrations where version='20261029160000'
), checks as (
  select count(*) as n,count(*) filter(where convalidated and contype='c' and pg_get_constraintdef(oid) ~ 'education' and pg_get_constraintdef(oid) ~ 'other') as valid,
    count(*) filter(where pg_get_constraintdef(oid) ~ 'oneline') as with_oneline
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname='app_meetings_activity_kind_check'
)
select 'kind check and history agree' as item,case when checks.n=1 and checks.valid=1 and (
  (history.n=0 and checks.with_oneline=0) or (history.n=1 and history.named=1 and checks.with_oneline=1)) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'one permissive owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'tagged meetings rows',count(*) filter(where business_area_id is not null)::text from public.app_meetings
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,''),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_activity_kind_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
