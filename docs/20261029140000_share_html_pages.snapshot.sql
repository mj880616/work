-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of the two existing share tables this migration refers to (app_share_pages: page FK; app_share_page_links: token_hash FK)
-- and the owner check function the new policies use. The new tables are absent before apply.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_share_pages','app_share_page_links','app_share_page_html','app_share_page_slugs')
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'trigger',tgrelid::regclass::text||'.'||tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'new table',n,case when to_regclass('public.'||n) is null then 'absent' else 'present' end from (values ('app_share_page_html'),('app_share_page_slugs')) v(n)
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_workspace_owner'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261020005000','20261029140000')
order by 1,2;
