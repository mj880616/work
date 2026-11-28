-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of the two shared article tables the new table points at, and the owner check function. The new table is absent before apply.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a
where a.attrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and a.attnum>0 and not a.attisdropped
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'trigger',tgrelid::regclass::text||'.'||tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'new table','app_feed_body_edits',case when to_regclass('public.app_feed_body_edits') is null then 'absent' else 'present' end
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_workspace_owner'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261115100000','20261115150000','20261126233000')
order by 1,2;
