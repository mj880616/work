-- SELECT only. Works after apply (record + 7-kind check) and after rollback/dry-run (no record + 6-kind original).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger or index change; no row added or removed).
with history as (
  select count(*) as n,count(*) filter(where name='share_pages_doc_block') as named from supabase_migrations.schema_migrations where version='20261022130000'
), checks as (
  select count(*) filter(where c.convalidated) as valid,count(*) as n,
    count(*) filter(where pg_get_constraintdef(c.oid) like '%@ == "doc"%') as with_doc
  from pg_constraint c where c.conrelid=to_regclass('public.app_share_pages') and c.conname='app_share_pages_blocks_check'
)
select 'blocks check and history agree' as item,case when checks.n=1 and checks.valid=1 and (
  (history.n=0 and checks.with_doc=0) or (history.n=1 and history.named=1 and checks.with_doc=1)) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_share_pages') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_share_pages'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_share_pages','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_share_pages') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_share_pages'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_share_pages')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_share_pages')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal;
