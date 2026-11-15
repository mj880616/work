-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_record_links (columns, constraints, indexes, policies, triggers, owner·RLS·grants), the new table name
-- (absent before apply) and the two functions this migration replaces (identity, definer flag, config, ACL, body hash — no body text).
select 'column' as kind,c.relname||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_record_links') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||k.conname,pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid
  where k.conrelid=to_regclass('public.app_record_links')
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_record_links','app_reference_bundles')
union all select 'policy',c.relname||'.'||p.polname,p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_record_links'),to_regclass('public.app_reference_bundles'))
union all select 'trigger',c.relname||'.'||t.tgname,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgrelid=to_regclass('public.app_record_links') and not t.tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid in (to_regclass('public.app_record_links'),to_regclass('public.app_reference_bundles'))
union all select 'table',n,coalesce(to_regclass(n)::text,'absent') from unnest(array['public.app_reference_bundles']) n
union all select 'function',p.proname,pg_get_function_identity_arguments(p.oid)||':definer='||p.prosecdef::text||':config='||coalesce(p.proconfig::text,'none')||':acl='||coalesce(p.proacl::text,'none')||':body='||md5(p.prosrc)
  from pg_proc p where p.oid in (to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261023231500','20261023023500')
order by 1,2;
