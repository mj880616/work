-- SELECT only. Works after apply (record + two new tables) and after rollback/dry-run (no record + no new tables).
-- The existing-table hash/count items must equal the precheck values of the same name (columns, constraints, policies, grants and
-- triggers of app_share_pages and app_share_page_links unchanged; no row added or removed there).
-- After apply also: RLS on both new tables, one authenticated owner policy each, no anon/PUBLIC privilege, service_role column SELECT only.
with history as (
  select count(*) as n,count(*) filter(where name='share_html_pages') as named from supabase_migrations.schema_migrations where version='20261029140000'
), tables as (
  select (to_regclass('public.app_share_page_html') is not null)::int + (to_regclass('public.app_share_page_slugs') is not null)::int as n
)
select 'new tables and history agree' as item,case when (history.n=0 and tables.n=0) or (history.n=1 and history.named=1 and tables.n=2) then '예' else '아니오' end as value
  from history,tables
union all select 'new tables RLS enabled',case when to_regclass('public.app_share_page_html') is null
  or (select count(*) from pg_class where oid in (to_regclass('public.app_share_page_html'),to_regclass('public.app_share_page_slugs')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'new tables one owner policy each',case when to_regclass('public.app_share_page_html') is null
  or ((select count(*) from pg_policy where polrelid=to_regclass('public.app_share_page_html') and polroles=array['authenticated'::regrole]::oid[])=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_share_page_slugs') and polroles=array['authenticated'::regrole]::oid[])=1
  and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_share_page_html'),to_regclass('public.app_share_page_slugs')))=2) then '예' else '아니오' end
union all select 'new tables no anon or public privilege',case when to_regclass('public.app_share_page_html') is null
  or (not exists(select 1 from pg_class where oid in (to_regclass('public.app_share_page_html'),to_regclass('public.app_share_page_slugs')) and relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_share_page_html'),to_regclass('public.app_share_page_slugs')) and attacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'service_role reads no slug text',case when to_regclass('public.app_share_page_slugs') is null
  or (not has_column_privilege('service_role','public.app_share_page_slugs','slug_name','select')
  and not has_column_privilege('service_role','public.app_share_page_slugs','slug_code','select')
  and has_column_privilege('service_role','public.app_share_page_slugs','slug_hash','select')) then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'share links rows',count(*)::text from public.app_share_page_links
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and attnum>0 and not attisdropped
union all select 'existing tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and not tgisinternal;
