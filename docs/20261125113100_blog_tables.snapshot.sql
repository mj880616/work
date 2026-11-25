-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of the existing tables the new tables refer to (app_share_pages: page FK and policy; app_notes: note FK and policy;
-- app_operator_features: the feature key check that gets 'blog') and the owner·feature check functions. The new tables are absent before apply.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_share_pages','app_notes','app_operator_features','app_blogs','app_blog_boards','app_blog_posts')
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'trigger',tgrelid::regclass::text||'.'||tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'new table',n,case when to_regclass('public.'||n) is null then 'absent' else 'present' end from unnest(array['app_blogs','app_blog_boards','app_blog_posts']) n
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('private.app_workspace_has_feature(uuid,text)'),to_regprocedure('public.app_operator_feature_workspace(text)'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261121090000','20261027050000','20261125113100')
order by 1,2;
