-- SELECT only. Save before apply. System catalogs and the migration history only (no row values of the four tables; the rows themselves are kept by the apply backup in ops_backup
-- and the old values of the changed columns by the new private table).
-- Schema snapshot of app_news_items, app_outside_posts, app_outside_sentences, app_feed_bodies (columns, constraints, indexes, policies, triggers, grants), the owner check function, and the fix table's absence.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid in (to_regclass('public.app_news_items'),to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'),to_regclass('public.app_feed_bodies')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_news_items'),to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'),to_regclass('public.app_feed_bodies'))
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_news_items','app_outside_posts','app_outside_sentences','app_feed_bodies')
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in (to_regclass('public.app_news_items'),to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'),to_regclass('public.app_feed_bodies'))
union all select 'trigger',tgrelid::regclass::text||'.'||tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid in (to_regclass('public.app_news_items'),to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'),to_regclass('public.app_feed_bodies')) and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid in (to_regclass('public.app_news_items'),to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'),to_regclass('public.app_feed_bodies'))
union all select 'fix table',n,coalesce(to_regclass(n)::text,'absent') from unnest(array['public.app_feed_entity_fixes']) n
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='app_is_workspace_owner'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261031230000','20261101233000','20261106050000','20261108010000')
order by 1,2;
